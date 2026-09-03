"use server";
import { revalidatePath } from "next/cache";
import { and, eq, gt, lt, desc, asc } from "drizzle-orm";
import { db } from "@/db";
import { branches, menuCategories, menuItems, auditLog } from "@/db/schema";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { parsePounds } from "@/lib/money";

/** Every action resolves the owning branch from the row itself, then checks access. */
function categoryBranch(categoryId: number): number {
  const row = db.select({ branchId: menuCategories.branchId }).from(menuCategories)
    .where(eq(menuCategories.id, categoryId)).get();
  if (!row) throw new Error("Category not found");
  return row.branchId;
}
function itemCategory(itemId: number): number {
  const row = db.select({ categoryId: menuItems.categoryId }).from(menuItems)
    .where(eq(menuItems.id, itemId)).get();
  if (!row) throw new Error("Dish not found");
  return row.categoryId;
}
/** The public pages are prerendered, so an edit here has to invalidate them too —
 *  otherwise the admin saves and the website keeps showing yesterday's price. */
function publish(branchId: number) {
  const row = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get();
  revalidatePath("/admin/menu");
  revalidatePath("/admin/rooms");
  if (!row) return;
  for (const p of ["", "/menu", "/drinks", "/private-dining-experiences", "/gallery"]) {
    revalidatePath(`/${row.slug}${p}`);
  }
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({ userId: session.userId, action, entity: "menu", entityId, detail: detail ?? null }).run();
}
const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function saveItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const categoryId = itemCategory(id);
  const branchId = categoryBranch(categoryId);
  assertBranchAccess(session, branchId);

  const name = clean(formData.get("name"));
  if (!name) return;

  db.update(menuItems).set({
    name,
    description: clean(formData.get("description")),
    pricePence: parsePounds(String(formData.get("price") ?? "")),
    measure: clean(formData.get("measure")),
    pricePence2: parsePounds(String(formData.get("price2") ?? "")),
    measure2: clean(formData.get("measure2")),
    meta: clean(formData.get("meta")),
    dietary: clean(formData.get("dietary"))?.toLowerCase().replace(/\s/g, "") ?? null,
    isPublished: formData.get("isPublished") === "on",
    isSignature: formData.get("isSignature") === "on",
  }).where(eq(menuItems.id, id)).run();

  log(session, "menu.item.update", String(id), name);
  publish(branchId);
}

export async function addItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const categoryId = Number(formData.get("categoryId"));
  const branchId = categoryBranch(categoryId);
  assertBranchAccess(session, branchId);

  const name = clean(formData.get("name"));
  if (!name) return;

  const last = db.select({ sort: menuItems.sort }).from(menuItems)
    .where(eq(menuItems.categoryId, categoryId)).orderBy(desc(menuItems.sort)).get();

  const created = db.insert(menuItems).values({
    categoryId, name,
    description: clean(formData.get("description")),
    pricePence: parsePounds(String(formData.get("price") ?? "")),
    measure: clean(formData.get("measure")),
    pricePence2: parsePounds(String(formData.get("price2") ?? "")),
    measure2: clean(formData.get("measure2")),
    meta: clean(formData.get("meta")),
    dietary: clean(formData.get("dietary"))?.toLowerCase().replace(/\s/g, "") ?? null,
    sort: (last?.sort ?? -1) + 1,
    isPublished: true,
  }).returning({ id: menuItems.id }).get();

  log(session, "menu.item.create", String(created.id), name);
  publish(branchId);
}

export async function deleteItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const branchId = categoryBranch(itemCategory(id));
  assertBranchAccess(session, branchId);
  db.delete(menuItems).where(eq(menuItems.id, id)).run();
  log(session, "menu.item.delete", String(id));
  publish(branchId);
}

export async function toggleItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const branchId = categoryBranch(itemCategory(id));
  assertBranchAccess(session, branchId);
  const row = db.select({ p: menuItems.isPublished }).from(menuItems).where(eq(menuItems.id, id)).get();
  db.update(menuItems).set({ isPublished: !row?.p }).where(eq(menuItems.id, id)).run();
  log(session, "menu.item.toggle", String(id), row?.p ? "hidden" : "shown");
  publish(branchId);
}

/** Swap sort with the neighbouring dish, so staff can reorder without drag and drop. */
export async function moveItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir"));
  const categoryId = itemCategory(id);
  const branchId = categoryBranch(categoryId);
  assertBranchAccess(session, branchId);

  const me = db.select().from(menuItems).where(eq(menuItems.id, id)).get();
  if (!me) return;

  const neighbour = dir === "up"
    ? db.select().from(menuItems).where(and(eq(menuItems.categoryId, categoryId), lt(menuItems.sort, me.sort)))
        .orderBy(desc(menuItems.sort)).get()
    : db.select().from(menuItems).where(and(eq(menuItems.categoryId, categoryId), gt(menuItems.sort, me.sort)))
        .orderBy(asc(menuItems.sort)).get();
  if (!neighbour) return;

  db.update(menuItems).set({ sort: neighbour.sort }).where(eq(menuItems.id, me.id)).run();
  db.update(menuItems).set({ sort: me.sort }).where(eq(menuItems.id, neighbour.id)).run();
  publish(branchId);
}

export async function saveCategory(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const branchId = categoryBranch(id);
  assertBranchAccess(session, branchId);
  const name = clean(formData.get("name"));
  if (!name) return;
  db.update(menuCategories).set({
    name, note: clean(formData.get("note")),
    isPublished: formData.get("isPublished") === "on",
  }).where(eq(menuCategories.id, id)).run();
  log(session, "menu.category.update", String(id), name);
  publish(branchId);
}

export async function addCategory(formData: FormData) {
  const session = await requireAbility("editMenu");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);

  const name = clean(formData.get("name"));
  if (!name) return;

  // Simple slug generation: lowercase, replace spaces/special chars with hyphens
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Find the maximum sort order for this branch/kind and increment
  const kindStr = String(formData.get("kind") || "food");
  const kind = (["food", "drinks", "set"].includes(kindStr) ? kindStr : "food") as "food" | "drinks" | "set";
  const maxSort = db.select({ sort: menuCategories.sort })
    .from(menuCategories)
    .where(and(eq(menuCategories.branchId, branchId), eq(menuCategories.kind, kind)))
    .orderBy(desc(menuCategories.sort))
    .limit(1)
    .get();
  const sort = (maxSort?.sort ?? -1) + 1;

  const created = db.insert(menuCategories).values({
    branchId,
    name,
    slug,
    kind,
    sort,
    isPublished: true,
  }).returning().get();

  if (created) {
    log(session, "menu.category.create", String(created.id), name);
    publish(branchId);
  }
}
