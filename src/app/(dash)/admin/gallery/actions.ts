"use server";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { branches, galleryImages, branchStats, auditLog } from "@/db/schema";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";

function log(session: Session, action: string, entity: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity, entityId, detail: detail ?? null,
  }).run();
}

/** Gallery and stat tiles both appear on prerendered public pages. */
function publish(branchId: number) {
  const row = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get();
  revalidatePath("/admin/gallery");
  if (!row) return;
  revalidatePath(`/${row.slug}`);
  revalidatePath(`/${row.slug}/gallery`);
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
  const src = clean(formData.get("src"));
  if (!src) return;

  const last = db.select({ sort: galleryImages.sort }).from(galleryImages)
    .where(eq(galleryImages.branchId, branchId)).orderBy(desc(galleryImages.sort)).get();

  const created = db.insert(galleryImages).values({
    branchId, src,
    alt: clean(formData.get("alt")),
    sort: (last?.sort ?? -1) + 1,
    isPublished: true,
  }).returning({ id: galleryImages.id }).get();

  log(session, "gallery.add", "gallery_image", String(created.id), src);
  publish(branchId);
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
}

export async function deleteImage(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = imageBranch(id);
  assertBranchAccess(session, branchId);
  db.delete(galleryImages).where(eq(galleryImages.id, id)).run();
  log(session, "gallery.delete", "gallery_image", String(id));
  publish(branchId);
}

export async function moveImage(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir"));
  const branchId = imageBranch(id);
  assertBranchAccess(session, branchId);

  const me = db.select().from(galleryImages).where(eq(galleryImages.id, id)).get();
  if (!me) return;
  const neighbour = dir === "up"
    ? db.select().from(galleryImages)
        .where(and(eq(galleryImages.branchId, branchId), lt(galleryImages.sort, me.sort)))
        .orderBy(desc(galleryImages.sort)).get()
    : db.select().from(galleryImages)
        .where(and(eq(galleryImages.branchId, branchId), gt(galleryImages.sort, me.sort)))
        .orderBy(asc(galleryImages.sort)).get();
  if (!neighbour) return;

  db.update(galleryImages).set({ sort: neighbour.sort }).where(eq(galleryImages.id, me.id)).run();
  db.update(galleryImages).set({ sort: me.sort }).where(eq(galleryImages.id, neighbour.id)).run();
  publish(branchId);
}

/* ---------------- venue stat tiles ---------------- */

export async function saveStat(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = statBranch(id);
  assertBranchAccess(session, branchId);

  const value = clean(formData.get("value"));
  const labelText = clean(formData.get("label"));
  if (!value || !labelText) return;

  db.update(branchStats).set({
    value, label: labelText,
    image: clean(formData.get("image")),
    href: clean(formData.get("href")),
  }).where(eq(branchStats.id, id)).run();

  log(session, "stat.update", "branch_stat", String(id), `${value} ${labelText}`);
  publish(branchId);
}

export async function addStat(formData: FormData) {
  const session = await requireAbility("editRooms");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);
  const value = clean(formData.get("value"));
  const labelText = clean(formData.get("label"));
  if (!value || !labelText) return;

  const last = db.select({ sort: branchStats.sort }).from(branchStats)
    .where(eq(branchStats.branchId, branchId)).orderBy(desc(branchStats.sort)).get();

  const created = db.insert(branchStats).values({
    branchId, value, label: labelText,
    image: clean(formData.get("image")),
    href: clean(formData.get("href")),
    sort: (last?.sort ?? -1) + 1,
  }).returning({ id: branchStats.id }).get();

  log(session, "stat.add", "branch_stat", String(created.id), `${value} ${labelText}`);
  publish(branchId);
}

export async function deleteStat(formData: FormData) {
  const session = await requireAbility("editRooms");
  const id = Number(formData.get("id"));
  const branchId = statBranch(id);
  assertBranchAccess(session, branchId);
  db.delete(branchStats).where(eq(branchStats.id, id)).run();
  log(session, "stat.delete", "branch_stat", String(id));
  publish(branchId);
}
