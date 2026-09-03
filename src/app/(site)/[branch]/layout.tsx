import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { allBranches, branchBySlug, telHref } from "@/lib/branches";
import { mainNav, fullNav, pageHref } from "@/lib/nav";
import { brand } from "@/lib/brand";

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
