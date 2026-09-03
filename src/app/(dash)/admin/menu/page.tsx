import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { branches, menuCategories, menuItems } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { formatPence } from "@/lib/money";
import { saveItem, addItem, deleteItem, toggleItem, moveItem, saveCategory, addCategory } from "./actions";

export const metadata = { title: "Menus" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";
const poundValue = (p: number | null) =>
  p == null ? "" : (p / 100).toFixed(2).replace(/\.00$/, "");

const KINDS = [
  { key: "food", label: "Food menu" },
  { key: "set", label: "Set menus" },
  { key: "drinks", label: "Drinks" },
] as const;
type Kind = (typeof KINDS)[number]["key"];

export default async function MenuAdmin({
  searchParams,
}: { searchParams: Promise<{ branch?: string; kind?: string }> }) {
  const session = await requireAbility("editMenu");
  const { branch: branchParam, kind: kindParam } = await searchParams;

  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const visible = session.role === "owner" ? all : all.filter((b) => b.id === session.branchId);
  const active = visible.find((b) => b.slug === branchParam) ?? visible[0];
  if (!active) notFound();

  const kind: Kind = KINDS.some((k) => k.key === kindParam) ? (kindParam as Kind) : "food";
  const isDrinks = kind === "drinks";

  const cats = db.select().from(menuCategories)
    .where(and(eq(menuCategories.branchId, active.id), eq(menuCategories.kind, kind)))
    .orderBy(asc(menuCategories.sort)).all();

  const catIds = cats.map((c) => c.id);
  const items = catIds.length
    ? db.select().from(menuItems).where(inArray(menuItems.categoryId, catIds))
        .orderBy(asc(menuItems.sort)).all()
    : [];

  const byCat = new Map<number, typeof items>();
  for (const i of items) {
    if (!byCat.has(i.categoryId)) byCat.set(i.categoryId, []);
    byCat.get(i.categoryId)!.push(i);
  }

  const tabHref = (b: string, k: string) => `/admin/menu?branch=${b}&kind=${k}`;

  return (
    <>
      <span className="accent text-xs text-gold-ink">Menus</span>
      <h1 className="text-3xl sm:text-4xl mt-3">{active.city}&rsquo;s menus</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Changes go live as soon as you save. Leave a price empty for anything served as part of a set menu.
        {isDrinks && " Wines and spirits can carry two prices — a glass measure and a bottle."}
      </p>

      <div className="flex flex-wrap gap-6 mt-7 border-b border-[--line]">
        {visible.length > 1 && (
          <div className="flex gap-1">
            {visible.map((b) => (
              <Link key={b.id} href={tabHref(b.slug, kind)}
                className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                  b.id === active.id ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
                {b.city}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-1 sm:ml-auto">
          {KINDS.map((k) => (
            <Link key={k.key} href={tabHref(active.slug, k.key)}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                k.key === kind ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {k.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Add new category */}
      <details className="mt-8 border border-[--line] bg-white/50">
        <summary className="px-5 py-4 cursor-pointer text-gold-ink font-semibold hover:bg-white">
          ＋ Add new {kind === "drinks" ? "drinks section" : kind === "set" ? "set menu" : "section"}
        </summary>
        <form action={addCategory} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-[1fr_auto] items-end bg-white">
          <input type="hidden" name="branchId" value={active.id} />
          <input type="hidden" name="kind" value={kind} />
          <div>
            <label className={label} htmlFor="newCatName">Section name</label>
            <input id="newCatName" name="name" className={field} required placeholder="e.g., Appetisers, House wines, etc." />
          </div>
          <button className="bg-ink text-pale px-5 py-2 text-sm font-semibold">Add section</button>
        </form>
      </details>

      {cats.length === 0 && (
        <p className="mt-10 text-ink-3">Nothing in this menu yet.</p>
      )}

      <div className="mt-8 grid gap-8">
        {cats.map((cat) => {
          const list = byCat.get(cat.id) ?? [];
          return (
            <section key={cat.id} className="border border-[--line] bg-white/50">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4 border-b border-[--line]">
                <h2 className="text-xl">{cat.name}</h2>
                <span className="text-xs text-ink-3">{list.length} {isDrinks ? "drinks" : "dishes"}</span>
                {!cat.isPublished && <span className="text-xs accent text-clay">Hidden</span>}
                <details className="ml-auto">
                  <summary className="text-xs underline cursor-pointer text-ink-3">Rename section</summary>
                  <form action={saveCategory} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end w-full">
                    <input type="hidden" name="id" value={cat.id} />
                    <div><label className={label} htmlFor={`cn${cat.id}`}>Section name</label>
                      <input id={`cn${cat.id}`} name="name" defaultValue={cat.name} className={field} /></div>
                    <div><label className={label} htmlFor={`cnote${cat.id}`}>Note under the heading</label>
                      <input id={`cnote${cat.id}`} name="note" defaultValue={cat.note ?? ""} className={field} /></div>
                    <label className="flex items-center gap-2 text-sm pb-2">
                      <input type="checkbox" name="isPublished" defaultChecked={cat.isPublished} /> Show
                    </label>
                    <button className="bg-ink text-pale px-4 py-2 text-sm font-semibold sm:col-span-3 justify-self-start">Save section</button>
                  </form>
                </details>
              </header>

              <ul className="divide-y divide-[--line]">
                {list.map((item, idx) => (
                  <li key={item.id} className={item.isPublished ? "" : "bg-clay/5"}>
                    <details>
                      <summary className="px-5 py-3 cursor-pointer flex items-baseline gap-3 hover:bg-white">
                        <span className="flex-1 leader">
                          <span className={item.isPublished ? "" : "line-through decoration-clay/60"}>{item.name}</span>
                          {item.dietary && <span className="text-xs text-ink-3 ml-2">({item.dietary})</span>}
                          <span className="fill" />
                          <span className="tnum text-sm">
                            {item.measure && <span className="text-xs text-ink-3 mr-1">{item.measure}</span>}
                            {item.pricePence == null ? "—" : formatPence(item.pricePence)}
                            {item.pricePence2 != null && (
                              <span className="text-ink-3">
                                {" / "}
                                {item.measure2 && <span className="text-xs mr-1">{item.measure2}</span>}
                                {formatPence(item.pricePence2)}
                              </span>
                            )}
                          </span>
                        </span>
                      </summary>

                      <div className="px-5 pb-5 pt-1 bg-white">
                        <form action={saveItem} className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                          <input type="hidden" name="id" value={item.id} />
                          <div><label className={label} htmlFor={`n${item.id}`}>{isDrinks ? "Drink" : "Dish"} name</label>
                            <input id={`n${item.id}`} name="name" defaultValue={item.name} className={field} required /></div>
                          <div><label className={label} htmlFor={`p${item.id}`}>Price</label>
                            <input id={`p${item.id}`} name="price" inputMode="decimal" placeholder="e.g. 14 or 14.50"
                              defaultValue={poundValue(item.pricePence)} className={field} /></div>

                          {isDrinks && (
                            <>
                              <div className="grid grid-cols-2 gap-4">
                                <div><label className={label} htmlFor={`m${item.id}`}>Measure</label>
                                  <input id={`m${item.id}`} name="measure" defaultValue={item.measure ?? ""}
                                    placeholder="175ml" className={field} /></div>
                                <div><label className={label} htmlFor={`m2${item.id}`}>Second measure</label>
                                  <input id={`m2${item.id}`} name="measure2" defaultValue={item.measure2 ?? ""}
                                    placeholder="75cl / Bottle" className={field} /></div>
                              </div>
                              <div><label className={label} htmlFor={`p2${item.id}`}>Second price</label>
                                <input id={`p2${item.id}`} name="price2" inputMode="decimal"
                                  defaultValue={poundValue(item.pricePence2)} className={field} /></div>
                              <div className="sm:col-span-2"><label className={label} htmlFor={`meta${item.id}`}>
                                Origin and style</label>
                                <input id={`meta${item.id}`} name="meta" defaultValue={item.meta ?? ""}
                                  placeholder="Italy ( VG / 3 / LM )" className={field} /></div>
                            </>
                          )}

                          <div className="sm:col-span-2"><label className={label} htmlFor={`d${item.id}`}>
                            {isDrinks ? "Tasting note or ingredients" : "Description"}</label>
                            <input id={`d${item.id}`} name="description" defaultValue={item.description ?? ""} className={field} /></div>
                          <div><label className={label} htmlFor={`a${item.id}`}>Allergens and diet</label>
                            <input id={`a${item.id}`} name="dietary" defaultValue={item.dietary ?? ""} placeholder="g,d,n,v,vg" className={field} />
                            <span className="block text-xs text-ink-3 mt-1">g gluten · d dairy · n nuts · v vegetarian · vg vegan</span></div>
                          <div className="flex flex-col gap-2 justify-end pb-1">
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="isPublished" defaultChecked={item.isPublished} /> Show on the website
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="isSignature" defaultChecked={item.isSignature} /> Mark as a signature {isDrinks ? "drink" : "dish"}
                            </label>
                          </div>
                          <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
                            Save changes
                          </button>
                        </form>

                        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[--line]">
                          <form action={toggleItem}><input type="hidden" name="id" value={item.id} />
                            <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">
                              {item.isPublished ? "Hide from website" : "Show on website"}</button></form>
                          {idx > 0 && (
                            <form action={moveItem}><input type="hidden" name="id" value={item.id} />
                              <input type="hidden" name="dir" value="up" />
                              <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">Move up</button></form>
                          )}
                          {idx < list.length - 1 && (
                            <form action={moveItem}><input type="hidden" name="id" value={item.id} />
                              <input type="hidden" name="dir" value="down" />
                              <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">Move down</button></form>
                          )}
                          <form action={deleteItem} className="ml-auto"><input type="hidden" name="id" value={item.id} />
                            <button className="text-xs text-brick border border-brick/40 px-3 py-1.5 hover:bg-clay/10">
                              Delete this {isDrinks ? "drink" : "dish"}</button></form>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>

              <details className="border-t border-[--line]">
                <summary className="px-5 py-3 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
                  Add to {cat.name}
                </summary>
                <form action={addItem} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-[2fr_1fr] bg-white">
                  <input type="hidden" name="categoryId" value={cat.id} />
                  <div><label className={label} htmlFor={`an${cat.id}`}>{isDrinks ? "Drink" : "Dish"} name</label>
                    <input id={`an${cat.id}`} name="name" className={field} required /></div>
                  <div><label className={label} htmlFor={`ap${cat.id}`}>Price</label>
                    <input id={`ap${cat.id}`} name="price" inputMode="decimal" placeholder="leave empty for set menus" className={field} /></div>
                  {isDrinks && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className={label} htmlFor={`am${cat.id}`}>Measure</label>
                          <input id={`am${cat.id}`} name="measure" placeholder="175ml" className={field} /></div>
                        <div><label className={label} htmlFor={`am2${cat.id}`}>Second measure</label>
                          <input id={`am2${cat.id}`} name="measure2" placeholder="75cl" className={field} /></div>
                      </div>
                      <div><label className={label} htmlFor={`ap2${cat.id}`}>Second price</label>
                        <input id={`ap2${cat.id}`} name="price2" inputMode="decimal" className={field} /></div>
                      <div className="sm:col-span-2"><label className={label} htmlFor={`ameta${cat.id}`}>Origin and style</label>
                        <input id={`ameta${cat.id}`} name="meta" className={field} /></div>
                    </>
                  )}
                  <div className="sm:col-span-2"><label className={label} htmlFor={`ad${cat.id}`}>
                    {isDrinks ? "Tasting note or ingredients" : "Description"}</label>
                    <input id={`ad${cat.id}`} name="description" className={field} /></div>
                  <div><label className={label} htmlFor={`aa${cat.id}`}>Allergens and diet</label>
                    <input id={`aa${cat.id}`} name="dietary" placeholder="g,d,n,v,vg" className={field} /></div>
                  <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
                    Add {isDrinks ? "drink" : "dish"}
                  </button>
                </form>
              </details>
            </section>
          );
        })}
      </div>
    </>
  );
}
