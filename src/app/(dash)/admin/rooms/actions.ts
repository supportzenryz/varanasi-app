"use server";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { branches, privateRooms, auditLog } from "@/db/schema";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { parsePounds } from "@/lib/money";

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

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity: "room", entityId, detail: detail ?? null,
  }).run();
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

  const name = clean(formData.get("name"));
  if (!name) return;

  db.update(privateRooms).set({
    name,
    headline: clean(formData.get("headline")),
    tagline: clean(formData.get("tagline")),
    description: clean(formData.get("description")),
    capacityMin: num(formData.get("capacityMin")),
    capacityMax: num(formData.get("capacityMax")),
    depositPerPersonPence: parsePounds(String(formData.get("deposit") ?? "")),
    hireChargePence: parsePounds(String(formData.get("hireCharge") ?? "")),
    exclusivityNote: clean(formData.get("exclusivityNote")),
    setMenuNote: clean(formData.get("setMenuNote")),
    idealFor: listJson(formData.get("idealFor")),
    image: clean(formData.get("image")),
    isPublished: formData.get("isPublished") === "on",
  }).where(eq(privateRooms.id, id)).run();

  log(session, "room.update", String(id), name);
  publish(branchId);
}

export async function addRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);

  const name = clean(formData.get("name"));
  if (!name) return;

  const last = db.select({ sort: privateRooms.sort }).from(privateRooms)
    .where(eq(privateRooms.branchId, branchId)).orderBy(desc(privateRooms.sort)).get();

  const created = db.insert(privateRooms).values({
    branchId, name, slug: slugify(name),
    capacityMax: num(formData.get("capacityMax")),
    tagline: clean(formData.get("tagline")),
    image: clean(formData.get("image")),
    sort: (last?.sort ?? -1) + 1,
    // a new room stays hidden until its details and photo are in place
    isPublished: false,
  }).returning({ id: privateRooms.id }).get();

  log(session, "room.create", String(created.id), name);
  publish(branchId);
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
}

export async function deleteRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = roomBranch(id);
  assertBranchAccess(session, branchId);
  db.delete(privateRooms).where(eq(privateRooms.id, id)).run();
  log(session, "room.delete", String(id));
  publish(branchId);
}

export async function moveRoom(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir"));
  const branchId = roomBranch(id);
  assertBranchAccess(session, branchId);

  const me = db.select().from(privateRooms).where(eq(privateRooms.id, id)).get();
  if (!me) return;

  const neighbour = dir === "up"
    ? db.select().from(privateRooms)
        .where(and(eq(privateRooms.branchId, branchId), lt(privateRooms.sort, me.sort)))
        .orderBy(desc(privateRooms.sort)).get()
    : db.select().from(privateRooms)
        .where(and(eq(privateRooms.branchId, branchId), gt(privateRooms.sort, me.sort)))
        .orderBy(asc(privateRooms.sort)).get();
  if (!neighbour) return;

  db.update(privateRooms).set({ sort: neighbour.sort }).where(eq(privateRooms.id, me.id)).run();
  db.update(privateRooms).set({ sort: me.sort }).where(eq(privateRooms.id, neighbour.id)).run();
  publish(branchId);
}
