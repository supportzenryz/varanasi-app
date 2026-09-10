import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { allBranches, branchBySlug, telHref } from "@/lib/branches";
import { mainNav, fullNav, pageHref } from "@/lib/nav";
import { brand } from "@/lib/brand";
import { restaurantJsonLd } from "@/lib/seo";

export function generateStaticParams() {
  return allBranches().map((b) => ({ branch: b.slug }));
}

export default async function BranchLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch || !branch.isPublished) notFound();

  return (
    <>
      {/* What Google shows about this restaurant before anybody clicks: the
          address, today's hours, the phone number and a Reserve button. Placed
          on the layout rather than the home page so every page of the branch
          carries it — a guest landing on the menu from a search is the common
          case, and that page has to identify the restaurant too.

          `@id` is the same on every page, so the two branches stay two
          businesses in Google's eyes and one does not absorb the other. */}
      <script
        type="application/ld+json"
        // The value is JSON.stringify of an object built from database columns
        // in lib/seo.ts, so it cannot carry markup out of the database and into
        // the page — and a <script type="application/ld+json"> is not executed
        // in any case. This is the sanctioned way to emit structured data.
        dangerouslySetInnerHTML={{ __html: restaurantJsonLd(branch, { image: brand.socialImage }) }}
      />
      {/* every rebuilt page opens with a dark full-bleed banner, so the header
          can sit over it and turn solid on scroll the way the live site does */}
      <SiteHeader
        overlay
        homeHref={`/${branch.slug}`}
        city={branch.city}
        phone={branch.phone}
        telHref={telHref(branch.phone)}
        bookHref={pageHref(branch.slug, "book-online")}
        logo={brand.logo}
        links={mainNav(branch.slug)}
        allLinks={fullNav(branch.slug)}
      />
      <main>{children}</main>
      <SiteFooter branch={branch} />
    </>
  );
}
