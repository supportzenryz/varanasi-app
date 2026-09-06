import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { galleryImages } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { pageHref } from "@/lib/nav";
import { mosaic } from "@/lib/mosaic";
import { PageHero } from "@/components/PageHero";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";

/* Written out rather than assembled, because Tailwind scans this file for
   class names and cannot follow `col-span-${n}`. */
const SPAN_SM = ["", "col-span-1", "col-span-2"] as const;
const SPAN_LG = ["", "lg:col-span-1", "lg:col-span-2", "lg:col-span-3", "lg:col-span-4"] as const;

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

  /* A photograph earns a feature slot by having the pixels for it, not by where
     it happens to sit in the list. Below this and it is only ever shown at tile
     size: a double tile is about 670px across on a desktop and the stretched
     one runs the full 1,350, so anything under this starts visibly softening.
     An unrecorded size is treated as large enough, which is how every image
     behaved before the sizes were recorded at all. */
  const FEATURE_MIN_WIDTH = 1200;
  const tiles = mosaic(rest.map((img) => img.width == null || img.width >= FEATURE_MIN_WIDTH));
  const laid = tiles.order.map((i) => rest[i]);

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
        {/* A mosaic rather than a uniform grid, so a wall of restaurant
            photography does not read as a contact sheet — but one that always
            closes its last row. See src/lib/mosaic.ts for what went wrong with
            the modulo this replaces. */}
        <ul className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4 grid-flow-dense
                       auto-rows-[10rem] sm:auto-rows-[14rem]">
          {laid.map((img, i) => {
            const isWide = tiles.wide.has(i);
            const isLast = i === laid.length - 1;
            return (
              <li key={img.id}
                className={`relative overflow-hidden hover-zoom ${
                  isWide ? "col-span-2 row-span-2" : ""
                } ${isLast && !isWide ? `${SPAN_SM[tiles.lastSpanSm]} ${SPAN_LG[tiles.lastSpanLg]}` : ""}`}>
                <Image src={img.src} alt={img.alt ?? ""} fill
                  sizes={isWide || isLast ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
                  className="object-cover" />
              </li>
            );
          })}
        </ul>

        {images.length === 0 && (
          <p className="text-center text-pale/70">Photographs are being added.</p>
        )}
      </section>

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
