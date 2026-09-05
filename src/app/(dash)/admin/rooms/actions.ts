"use server";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { branches, privateRooms } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { parsePounds } from "@/lib/money";
import { ok, problem } from "@/lib/admin-feedback";

/** Resolve the owning branch from the row itself, never from the submitted form. */
function roomBranch(roomId: number): number {
  const row = db.select({ branchId: privateRooms.branchId }).from(privateRooms)
    .where(eq(privateRooms.id, roomId)).get();
  if (!row) throw new Error("Room not found");
  return row.branchId;
}

/** Public pages are prerendered, so an edit here has to invalidate them too. */
function publish(branchId: number) {
  const row = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get();
  revalidatePath("/admin/rooms");
  if (!row) return;
  revalidatePath(`/${row.slug}`);
  revalidatePath(`/${row.slug}/private-dining-experiences`);
}

function backTo(branchId: number): string {
  const slug = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get()?.slug;
  return "/admin/rooms" + (slug ? `?branch=${slug}` : "");
}

/** See the same helper in the menu actions: an unreadable price used to clear
 *  the field rather than be refused, so a room quietly lost its deposit. */
function priceOrRefuse(raw: FormDataEntryValue | null, field: string, back: string): number | null {
  const typed = String(raw ?? "").trim();
  if (!typed) return null;
  const pence = parsePounds(typed);
  if (pence == null) {
    problem(back, `"${typed}" isn't a price we can read for ${field}. Use figures only, like 250 or 250.00.`);
  }
  return pence;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "room", entityId, detail });
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[^0-9]/g, "");
  return s === "" ? null : Number(s);
};
/** "Family Gatherings, Birthdays" -> JSON array, which is how the page reads it. */
const listJson = (v: FormDataEntryValue | null) => {
  const parts = String(v ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? JSON.stringify(parts) : null;
};
const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function saveRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = roomBranch(id);
  assertBranchAccess(session, branchId);

  const back = backTo(branchId);
  const name = clean(formData.get("name"));
  if (!name) problem(back, "A room needs a name.");

  /* Capacities are shown to guests and used to size a booking. min above max
     is not a room anyone can book, and was accepted without comment. */
  const capMin = num(formData.get("capacityMin"));
  const capMax = num(formData.get("capacityMax"));
  if (capMin != null && capMax != null && capMin > capMax) {
    problem(back, `The smallest party (${capMin}) can't be larger than the largest (${capMax}).`);
  }
  if (capMax != null && capMax > 500) {
    problem(back, `${capMax} guests looks like a typo — check the largest party.`);
  }

  db.update(privateRooms).set({
    name,
    headline: clean(formData.get("headline")),
    tagline: clean(formData.get("tagline")),
    description: clean(formData.get("description")),
    capacityMin: capMin,
    capacityMax: capMax,
    depositPerPersonPence: priceOrRefuse(formData.get("deposit"), "the deposit", back),
    hireChargePence: priceOrRefuse(formData.get("hireCharge"), "the hire charge", back),
    exclusivityNote: clean(formData.get("exclusivityNote")),
    setMenuNote: clean(formData.get("setMenuNote")),
    idealFor: listJson(formData.get("idealFor")),
    image: clean(formData.get("image")),
    isPublished: formData.get("isPublished") === "on",
  }).where(eq(privateRooms.id, id)).run();

  log(session, "room.update", String(id), name);
  publish(branchId);
  ok(back, formData.get("isPublished") === "on"
    ? `${name} saved and showing on the website.`
    : `${name} saved. It stays hidden from the website until you switch it on.`);
}

export async function addRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);

  const back = backTo(branchId);
  const name = clean(formData.get("name"));
  if (!name) problem(back, "A room needs a name.");

  /* The slug is the room's URL. Two rooms sharing one means the second is
     unreachable from the website. */
  const base = slugify(name);
  if (!base) problem(back, "A room name needs at least one letter or number in it.");
  const taken = new Set(db.select({ slug: privateRooms.slug }).from(privateRooms)
    .where(eq(privateRooms.branchId, branchId)).all().map((r) => r.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

  const last = db.select({ sort: privateRooms.sort }).from(privateRooms)
    .where(eq(privateRooms.branchId, branchId)).orderBy(desc(privateRooms.sort)).get();

  const created = db.insert(privateRooms).values({
    branchId, name, slug,
    capacityMax: num(formData.get("capacityMax")),
    tagline: clean(formData.get("tagline")),
    image: clean(formData.get("image")),
    sort: (last?.sort ?? -1) + 1,
    // a new room stays hidden until its details and photo are in place
    isPublished: false,
  }).returning({ id: privateRooms.id }).get();

  log(session, "room.create", String(created.id), name);
  publish(branchId);
  ok(back, `${name} added. It's hidden from the website until you fill in the details and switch it on.`);
}

export async function toggleRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = roomBranch(id);
  assertBranchAccess(session, branchId);
  const row = db.select({ p: privateRooms.isPublished }).from(privateRooms)
    .where(eq(privateRooms.id, id)).get();
  db.update(privateRooms).set({ isPublished: !row?.p }).where(eq(privateRooms.id, id)).run();
  log(session, "room.toggle", String(id), row?.p ? "hidden" : "shown");
  publish(branchId);
  ok(backTo(branchId), row?.p
    ? "Hidden from the website. Enquiries already made are unaffected."
    : "Showing on the website now.");
}

export async function deleteRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = roomBranch(id);
  assertBranchAccess(session, branchId);
  const gone = db.select({ name: privateRooms.name }).from(privateRooms).where(eq(privateRooms.id, id)).get();
  db.delete(privateRooms).where(eq(privateRooms.id, id)).run();
  log(session, "room.delete", String(id), gone?.name);
  publish(branchId);
  ok(backTo(branchId), `${gone?.name ?? "The room"} deleted. To take one off the website without losing it, hide it instead.`);
}

export async function moveRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir"));
  const branchId = roomBranch(id);
  assertBranchAccess(session, branchId);

  const back = backTo(branchId);
  const me = db.select().from(privateRooms).where(eq(privateRooms.id, id)).get();
  if (!me) problem(back, "That room has already been removed.");

  const neighbour = dir === "up"
    ? db.select().from(privateRooms)
        .where(and(eq(privateRooms.branchId, branchId), lt(privateRooms.sort, me!.sort)))
        .orderBy(desc(privateRooms.sort)).get()
    : db.select().from(privateRooms)
        .where(and(eq(privateRooms.branchId, branchId), gt(privateRooms.sort, me!.sort)))
        .orderBy(asc(privateRooms.sort)).get();
  if (!neighbour) problem(back, `${me!.name} is already ${dir === "up" ? "first" : "last"}.`);

  db.update(privateRooms).set({ sort: neighbour!.sort }).where(eq(privateRooms.id, me!.id)).run();
  db.update(privateRooms).set({ sort: me!.sort }).where(eq(privateRooms.id, neighbour!.id)).run();
  publish(branchId);
  ok(back, `${me!.name} moved ${dir === "up" ? "up" : "down"}.`);
}
