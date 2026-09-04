import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menuItems } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { DIETARY_LABELS } from "@/lib/money";
import { pageHref } from "@/lib/nav";
import { branchMedia } from "@/lib/brand";
import { PageHero } from "@/components/PageHero";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";
import { MenuSections, type MenuItemRow } from "@/components/MenuList";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Our Menu",
    description: `The à la carte and tasting menus at Varanasi ${b.city}.`,
    alternates: { canonical: `/${b.slug}/menu` },
  };
}

export default async function MenuPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);

  const cats = db.select().from(menuCategories)
    .where(and(
      eq(menuCategories.branchId, branch.id),
      eq(menuCategories.isPublished, true),
      inArray(menuCategories.kind, ["food", "set"]),
    ))
    .orderBy(asc(menuCategories.sort)).all();

  const catIds = cats.map((c) => c.id);
  const items = catIds.length
    ? db.select().from(menuItems)
        .where(and(eq(menuItems.isPublished, true), inArray(menuItems.categoryId, catIds)))
        .orderBy(asc(menuItems.sort)).all()
    : [];

  const byCat = new Map<number, MenuItemRow[]>();
  for (const i of items) {
    if (!byCat.has(i.categoryId)) byCat.set(i.categoryId, []);
    byCat.get(i.categoryId)!.push(i);
  }

  const withItems = cats.filter((c) => (byCat.get(c.id) ?? []).length > 0);
  const alaCarte = withItems.filter((c) => c.kind === "food");
  const setMenus = withItems.filter((c) => c.kind === "set");

  const usedCodes = new Set<string>();
  for (const i of items) i.dietary?.split(",").forEach((c) => c && usedCodes.add(c));

  return (
    <>
      <PageHero
        align="center"
        image={media.menuHero}
        kicker={`Varanasi ${branch.city}`}
        heading="Our Menu"
        intro="A continually evolving repertoire — some classics, some reworked favourites, plus new dishes for each season."
      >
        <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold">Reserve a table</Link>
        <Link href={pageHref(branch.slug, "drinks")} className="btn btn-outline">Drinks &amp; cocktails</Link>
      </PageHero>

      <div className="mx-auto max-w-3xl px-5 lg:px-8 py-16 sm:py-20">
        <MenuSections categories={alaCarte} itemsByCategory={byCat} />

        {setMenus.length > 0 && (
          <div className="mt-20 sm:mt-28 pt-16 border-t border-[--line]">
            <header className="text-center mb-14">
              <p className="accent text-[0.62rem] text-gold">Tasting menus</p>
              <h2 className="text-3xl sm:text-4xl mt-4">Served for the whole table</h2>
            </header>
            <MenuSections categories={setMenus} itemsByCategory={byCat} />
          </div>
        )}

        <section className="mt-20 pt-14 border-t border-[--line] text-center">
          <p className="accent text-[0.62rem] text-gold">Drinks</p>
          <h2 className="text-2xl sm:text-3xl mt-4">Wine, cocktails and spirits</h2>
          <p className="text-sm text-pale/70 mt-4 max-w-[48ch] mx-auto leading-relaxed">
            An elegant wine and drinks list with an extensive selection of gins, whiskies, rums and cognacs,
            championing the cocktail sector with &ldquo;The Jewel of Varanasi&rdquo;.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link href={pageHref(branch.slug, "drinks")} className="btn btn-ink">View the drinks menu</Link>
            {branch.drinksPdf && (
              <a href={branch.drinksPdf} target="_blank" rel="noopener noreferrer"
                className="btn border border-pale/25 hover:border-gold hover:text-gold">
                Download PDF
              </a>
            )}
          </div>
        </section>

        {usedCodes.size > 0 && (
          <section aria-labelledby="allergens" className="mt-20 pt-14 border-t border-[--line]">
            <h2 id="allergens" className="accent text-[0.62rem] text-gold">Allergens and diet</h2>
            <dl className="mt-6 grid gap-x-10 gap-y-2.5 sm:grid-cols-2 text-sm">
              {[...usedCodes].sort().map((c) => (
                <div key={c} className="flex gap-2.5">
                  <dt className="font-semibold">({c})</dt>
                  <dd className="text-pale/70">{DIETARY_LABELS[c] ?? "See your server"}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-pale/70 mt-7 max-w-[64ch] leading-relaxed">
              Prices include VAT. A discretionary service charge is added to tables of six or more. Our dishes are
              prepared in a kitchen where allergens are present, so we cannot guarantee any dish is entirely free
              from traces — please speak to your server before ordering.
            </p>
          </section>
        )}
      </div>

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
