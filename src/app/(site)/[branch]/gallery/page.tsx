import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { galleryImages } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { pageHref } from "@/lib/nav";
import { PageHero } from "@/components/PageHero";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Gallery",
    description: `Inside Varanasi ${b.city} — the dining room, the private spaces and the food.`,
    alternates: { canonical: `/${b.slug}/gallery` },
  };
}

export default async function GalleryPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  const images = db.select().from(galleryImages)
    .where(and(eq(galleryImages.branchId, branch.id), eq(galleryImages.isPublished, true)))
    .orderBy(asc(galleryImages.sort)).all();

  const [hero, ...rest] = images;

  return (
    <>
      <PageHero
        align="center"
        image={hero?.src ?? null}
        kicker={`Varanasi ${branch.city}`}
        heading="Gallery"
        intro="The dining room, the private spaces, the bar and the food."
      >
        <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold">Reserve a table</Link>
      </PageHero>

      <section className="mx-auto max-w-[84rem] px-5 lg:px-10 py-16 sm:py-20">
        {/* a simple mosaic: every fourth image runs wide, which keeps a grid of
            mixed-orientation restaurant photography from looking mechanical */}
        <ul className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4 grid-flow-dense
                       auto-rows-[10rem] sm:auto-rows-[14rem]">
          {rest.map((img, i) => (
            <li key={img.id}
              className={`relative overflow-hidden hover-zoom ${
                i % 7 === 0 ? "col-span-2 row-span-2" : ""
              }`}>
              <Image src={img.src} alt={img.alt ?? ""} fill
                sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
            </li>
          ))}
        </ul>

        {images.length === 0 && (
          <p className="text-center text-pale/70">Photographs are being added.</p>
        )}
      </section>

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
