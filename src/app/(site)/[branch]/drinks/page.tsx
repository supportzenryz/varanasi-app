import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menuItems } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
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
    title: "Drinks & Cocktail Menu",
    description: `Champagne, wine, signature cocktails, mocktails and spirits at Varanasi ${b.city}.`,
    alternates: { canonical: `/${b.slug}/drinks` },
  };
}

export default async function DrinksPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);

  const cats = db.select().from(menuCategories)
    .where(and(
      eq(menuCategories.branchId, branch.id),
      eq(menuCategories.isPublished, true),
      eq(menuCategories.kind, "drinks"),
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

  return (
    <>
      <PageHero
        align="center"
        image={media.drinksHero ?? media.menuHero}
        kicker={`Varanasi ${branch.city}`}
        heading="Drinks &amp; Cocktails"
        intro="Champagne and fine wine, signature and classic cocktails, an extensive spirits list — and a mocktail menu built with the same care."
      >
        <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold">Reserve a table</Link>
        {branch.drinksPdf && (
          <a href={branch.drinksPdf} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
            Download PDF
          </a>
        )}
      </PageHero>

      <div className="mx-auto max-w-3xl px-5 lg:px-8 py-16 sm:py-20">
        <MenuSections categories={withItems} itemsByCategory={byCat} />

        <section className="mt-20 pt-14 border-t border-[--line]">
          <h2 className="accent text-[0.62rem] text-gold">Reading the wine list</h2>
          <dl className="mt-6 grid gap-3 text-sm">
            <div className="flex gap-3">
              <dt className="font-semibold shrink-0">Sweetness</dt>
              <dd className="text-pale/70">Scaled 1–6, from sweetest to least sweet.</dd>
            </div>
            <div className="flex gap-3">
              <dt className="font-semibold shrink-0">Body</dt>
              <dd className="text-pale/70">
                M medium · LM light medium · MH medium heavy · H heavy · VG vegan
              </dd>
            </div>
          </dl>
          <p className="text-xs text-pale/70 mt-7 max-w-[64ch] leading-relaxed">
            Prices include VAT. A discretionary service charge is added to tables of six or more. We operate
            Challenge 25 — please be ready to show ID.
          </p>
        </section>
      </div>

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
