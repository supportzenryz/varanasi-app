import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug } from "@/lib/branches";
import { termsDoc } from "@/lib/legal";
import { PageHero } from "@/components/PageHero";
import { LegalBody } from "@/components/LegalPage";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Terms & Conditions",
    description: "Terms & Conditions for Varanasi Restaurant.",
    alternates: { canonical: `/${b.slug}/terms` },
  };
}

export default async function LegalPageRoute({ params }: { params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  return (
    <>
      <PageHero image={branch.heroImage} kicker="terms" heading={termsDoc.title} />
      <section className="bg-ink">
        <div className="mx-auto max-w-[52rem] px-5 lg:px-10 py-14 sm:py-20">
          <LegalBody doc={termsDoc} />
        </div>
      </section>
    </>
  );
}
