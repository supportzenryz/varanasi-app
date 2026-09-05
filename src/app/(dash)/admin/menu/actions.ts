"use server";
import { revalidatePath } from "next/cache";
import { and, eq, gt, lt, desc, asc } from "drizzle-orm";
import { db } from "@/db";
import { branches, menuCategories, menuItems } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";
import { parsePounds } from "@/lib/money";

/** Every action resolves the owning branch from the row itself, then checks access. */
/** Where a redirect should land: the branch and menu tab the person was on.
 *  Without this a "not saved" message from the drinks list appears over the
 *  food menu of whichever branch happens to sort first. */
function backTo(branchId: number, kind?: string | null): string {
  const slug = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get()?.slug;
  if (!slug) return "/admin/menu";
  const k = kind && ["food", "set", "drinks"].includes(kind) ? kind : null;
  return `/admin/menu?branch=${slug}${k ? `&kind=${k}` : ""}`;
}

/** A price box that was typed in but cannot be read.
 *
 *  `parsePounds` returns null for anything it does not recognise, and null is
 *  also how "no price" is stored — so "14 / 18", "TBC" and "P.O.A." silently
 *  removed the price from a published dish rather than being refused. An empty
 *  box still means no price; a full one that cannot be read is now an error. */
function priceOrRefuse(raw: FormDataEntryValue | null, field: string, back: string): number | null {
  const typed = String(raw ?? "").trim();
  if (!typed) return null;
  const pence = parsePounds(typed);
  if (pence == null) {
    problem(back, `"${typed}" isn't a price we can read for ${field}. ` +
      `Use figures only, like 14 or 14.50 — leave it empty if there is no price.`);
  }
  return pence;
}

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
  record(session, { action, entity: "menu", entityId, detail });
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

  const back = backTo(branchId, String(formData.get("kind") ?? ""));
  const name = clean(formData.get("name"));
  if (!name) problem(back, "A dish needs a name.");

  db.update(menuItems).set({
    name,
    description: clean(formData.get("description")),
    pricePence: priceOrRefuse(formData.get("price"), "the price", back),
    measure: clean(formData.get("measure")),
    pricePence2: priceOrRefuse(formData.get("price2"), "the second price", back),
    measure2: clean(formData.get("measure2")),
    meta: clean(formData.get("meta")),
    dietary: clean(formData.get("dietary"))?.toLowerCase().replace(/\s/g, "") ?? null,
    isPublished: formData.get("isPublished") === "on",
    isSignature: formData.get("isSignature") === "on",
  }).where(eq(menuItems.id, id)).run();

  log(session, "menu.item.update", String(id), name);
  publish(branchId);
  ok(back, `${name} saved. It's live on the website now.`);
}

export async function addItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const categoryId = Number(formData.get("categoryId"));
  const branchId = categoryBranch(categoryId);
  assertBranchAccess(session, branchId);

  const back = backTo(branchId, String(formData.get("kind") ?? ""));
  const name = clean(formData.get("name"));
  if (!name) problem(back, "A dish needs a name.");

  const last = db.select({ sort: menuItems.sort }).from(menuItems)
    .where(eq(menuItems.categoryId, categoryId)).orderBy(desc(menuItems.sort)).get();

  const created = db.insert(menuItems).values({
    categoryId, name,
    description: clean(formData.get("description")),
    pricePence: priceOrRefuse(formData.get("price"), "the price", back),
    measure: clean(formData.get("measure")),
    pricePence2: priceOrRefuse(formData.get("price2"), "the second price", back),
    measure2: clean(formData.get("measure2")),
    meta: clean(formData.get("meta")),
    dietary: clean(formData.get("dietary"))?.toLowerCase().replace(/\s/g, "") ?? null,
    sort: (last?.sort ?? -1) + 1,
    isPublished: true,
  }).returning({ id: menuItems.id }).get();

  log(session, "menu.item.create", String(created.id), name);
  publish(branchId);
  ok(back, `${name} added and published.`);
}

export async function deleteItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const branchId = categoryBranch(itemCategory(id));
  assertBranchAccess(session, branchId);
  const gone = db.select({ name: menuItems.name }).from(menuItems).where(eq(menuItems.id, id)).get();
  db.delete(menuItems).where(eq(menuItems.id, id)).run();
  log(session, "menu.item.delete", String(id), gone?.name);
  publish(branchId);
  ok(backTo(branchId, String(formData.get("kind") ?? "")),
    `${gone?.name ?? "The dish"} deleted. To take something off the website without losing it, use Hide instead.`);
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
  ok(backTo(branchId, String(formData.get("kind") ?? "")),
    row?.p ? "Hidden from the website. It's still here, and can be shown again."
           : "Showing on the website now.");
}

/** Swap sort with the neighbouring dish, so staff can reorder without drag and drop. */
export async function moveItem(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const dir = String(formData.get("dir"));
  const categoryId = itemCategory(id);
  const branchId = categoryBranch(categoryId);
  assertBranchAccess(session, branchId);

  const back = backTo(branchId, String(formData.get("kind") ?? ""));
  const me = db.select().from(menuItems).where(eq(menuItems.id, id)).get();
  if (!me) problem(back, "That dish has already been removed.");

  const neighbour = dir === "up"
    ? db.select().from(menuItems).where(and(eq(menuItems.categoryId, categoryId), lt(menuItems.sort, me.sort)))
        .orderBy(desc(menuItems.sort)).get()
    : db.select().from(menuItems).where(and(eq(menuItems.categoryId, categoryId), gt(menuItems.sort, me.sort)))
        .orderBy(asc(menuItems.sort)).get();
  if (!neighbour) {
    problem(back, `${me!.name} is already ${dir === "up" ? "first" : "last"} in its section.`);
  }

  db.update(menuItems).set({ sort: neighbour!.sort }).where(eq(menuItems.id, me!.id)).run();
  db.update(menuItems).set({ sort: me!.sort }).where(eq(menuItems.id, neighbour!.id)).run();
  publish(branchId);
}

export async function saveCategory(formData: FormData) {
  const session = await requireAbility("editMenu");
  const id = Number(formData.get("id"));
  const branchId = categoryBranch(id);
  assertBranchAccess(session, branchId);
  const back = backTo(branchId, String(formData.get("kind") ?? ""));
  const name = clean(formData.get("name"));
  if (!name) problem(back, "A section needs a heading.");
  db.update(menuCategories).set({
    name, note: clean(formData.get("note")),
    isPublished: formData.get("isPublished") === "on",
  }).where(eq(menuCategories.id, id)).run();
  log(session, "menu.category.update", String(id), name);
  publish(branchId);
  ok(back, `Section renamed to "${name}".`);
}

export async function addCategory(formData: FormData) {
  const session = await requireAbility("editMenu");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);

  const kindStr = String(formData.get("kind") || "food");
  const kind = (["food", "drinks", "set"].includes(kindStr) ? kindStr : "food") as "food" | "drinks" | "set";
  const back = backTo(branchId, kind);

  const name = clean(formData.get("name"));
  if (!name) problem(back, "A section needs a heading.");

  /* The slug is the anchor the public menu page links each section by. Built
     from the heading, so "Chef's Specials" and "Chefs Specials" both become
     "chefs-specials" — two sections sharing one anchor, where the second is
     unreachable. And a heading with no letters or digits in it at all ("***")
     produced an empty slug, which links nowhere. Both were accepted silently. */
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!base) {
    problem(back, "A section heading needs at least one letter or number in it.");
  }
  const taken = new Set(
    db.select({ slug: menuCategories.slug }).from(menuCategories)
      .where(eq(menuCategories.branchId, branchId)).all().map((c) => c.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

  // Find the maximum sort order for this branch/kind and increment
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

  log(session, "menu.category.create", String(created.id), `${name} (${kind})`);
  publish(branchId);
  ok(back, `Section "${name}" added. Add dishes to it below.`);
}
