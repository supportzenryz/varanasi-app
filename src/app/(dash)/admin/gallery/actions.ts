"use server";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { branches, galleryImages, branchStats } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";

function log(session: Session, action: string, entity: string, entityId: string, detail?: string) {
  record(session, { action, entity, entityId, detail });
}

/** Gallery and stat tiles both appear on prerendered public pages. */
function publish(branchId: number) {
  const row = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get();
  revalidatePath("/admin/gallery");
  if (!row) return;
  revalidatePath(`/${row.slug}`);
  revalidatePath(`/${row.slug}/gallery`);
}

function backTo(branchId: number): string {
  const slug = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get()?.slug;
  return "/admin/gallery" + (slug ? `?branch=${slug}` : "");
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

function imageBranch(id: number): number {
  const row = db.select({ branchId: galleryImages.branchId }).from(galleryImages)
    .where(eq(galleryImages.id, id)).get();
  if (!row) throw new Error("Image not found");
  return row.branchId;
}
function statBranch(id: number): number {
  const row = db.select({ branchId: branchStats.branchId }).from(branchStats)
    .where(eq(branchStats.id, id)).get();
  if (!row) throw new Error("Tile not found");
  return row.branchId;
}

/* ---------------- gallery ---------------- */

export async function addImage(formData: FormData) {
  const session = await requireAbility("editRooms");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);
  const back = backTo(branchId);
  const src = clean(formData.get("src"));
  if (!src) problem(back, "Paste the image address before adding it.");
  /* A path that isn't an image path shows as a broken picture on the public
     gallery, which the person adding it never sees from this screen. */
  if (!/^(https?:\/\/|\/)/.test(src!)) {
    problem(back, "That doesn't look like an image address. It should start with https:// or with a /.");
  }

  const last = db.select({ sort: galleryImages.sort }).from(galleryImages)
    .where(eq(galleryImages.branchId, branchId)).orderBy(desc(galleryImages.sort)).get();

  const created = db.insert(galleryImages).values({
    branchId, src: src!,
    alt: clean(formData.get("alt")),
    sort: (last?.sort ?? -1) + 1,
    isPublished: true,
  }).returning({ id: galleryImages.id }).get();

  log(session, "gallery.add", "gallery_image", String(created.id), src!);
  publish(branchId);
  ok(back, "Photograph added to the gallery.");
}

export async function updateImage(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = imageBranch(id);
  assertBranchAccess(session, branchId);

  db.update(galleryImages).set({
    alt: clean(formData.get("alt")),
    isFeatured: formData.get("isFeatured") === "on",
    isPublished: formData.get("isPublished") === "on",
  }).where(eq(galleryImages.id, id)).run();

  log(session, "gallery.update", "gallery_image", String(id));
  publish(branchId);
  ok(backTo(branchId), "Photograph saved.");
}

export async function deleteImage(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = imageBranch(id);
  assertBranchAccess(session, branchId);
  db.delete(galleryImages).where(eq(galleryImages.id, id)).run();
  log(session, "gallery.delete", "gallery_image", String(id));
  publish(branchId);
  ok(backTo(branchId), "Photograph removed from the gallery.");
}

export async function moveImage(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir"));
  const branchId = imageBranch(id);
  assertBranchAccess(session, branchId);

  const back = backTo(branchId);
  const me = db.select().from(galleryImages).where(eq(galleryImages.id, id)).get();
  if (!me) problem(back, "That photograph has already been removed.");
  const neighbour = dir === "up"
    ? db.select().from(galleryImages)
        .where(and(eq(galleryImages.branchId, branchId), lt(galleryImages.sort, me!.sort)))
        .orderBy(desc(galleryImages.sort)).get()
    : db.select().from(galleryImages)
        .where(and(eq(galleryImages.branchId, branchId), gt(galleryImages.sort, me!.sort)))
        .orderBy(asc(galleryImages.sort)).get();
  if (!neighbour) problem(back, `That photograph is already ${dir === "up" ? "first" : "last"}.`);

  db.update(galleryImages).set({ sort: neighbour!.sort }).where(eq(galleryImages.id, me!.id)).run();
  db.update(galleryImages).set({ sort: me!.sort }).where(eq(galleryImages.id, neighbour!.id)).run();
  publish(branchId);
  ok(back, `Moved ${dir === "up" ? "up" : "down"}.`);
}

/* ---------------- venue stat tiles ---------------- */

export async function saveStat(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = statBranch(id);
  assertBranchAccess(session, branchId);

  const back = backTo(branchId);
  const value = clean(formData.get("value"));
  const labelText = clean(formData.get("label"));
  if (!value) problem(back, "A tile needs a figure — the large text.");
  if (!labelText) problem(back, "A tile needs a caption under the figure.");

  db.update(branchStats).set({
    value: value!, label: labelText!,
    image: clean(formData.get("image")),
    href: clean(formData.get("href")),
  }).where(eq(branchStats.id, id)).run();

  log(session, "stat.update", "branch_stat", String(id), `${value} ${labelText}`);
  publish(branchId);
  ok(back, "Tile saved.");
}

export async function addStat(formData: FormData) {
  const session = await requireAbility("editRooms");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);
  const back = backTo(branchId);
  const value = clean(formData.get("value"));
  const labelText = clean(formData.get("label"));
  if (!value) problem(back, "A tile needs a figure — the large text.");
  if (!labelText) problem(back, "A tile needs a caption under the figure.");

  const last = db.select({ sort: branchStats.sort }).from(branchStats)
    .where(eq(branchStats.branchId, branchId)).orderBy(desc(branchStats.sort)).get();

  const created = db.insert(branchStats).values({
    branchId, value: value!, label: labelText!,
    image: clean(formData.get("image")),
    href: clean(formData.get("href")),
    sort: (last?.sort ?? -1) + 1,
  }).returning({ id: branchStats.id }).get();

  log(session, "stat.add", "branch_stat", String(created.id), `${value} ${labelText}`);
  publish(branchId);
  ok(back, "Tile added to the home page.");
}

export async function deleteStat(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = statBranch(id);
  assertBranchAccess(session, branchId);
  db.delete(branchStats).where(eq(branchStats.id, id)).run();
  log(session, "stat.delete", "branch_stat", String(id));
  publish(branchId);
  ok(backTo(branchId), "Tile removed from the home page.");
}
