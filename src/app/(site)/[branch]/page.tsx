import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { galleryImages, menuCategories, menuItems, privateRooms } from "@/db/schema";
import { branchBySlug, openingHours, telHref } from "@/lib/branches";
import { formatPence } from "@/lib/money";
import { pageHref } from "@/lib/nav";
import { brand, branchMedia } from "@/lib/brand";
import { PageHero } from "@/components/PageHero";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: b.heroHeading ?? `Indian Fine Dining Restaurant in ${b.city}`,
    description: b.intro ?? undefined,
    alternates: { canonical: `/${b.slug}` },
    openGraph: { images: [brand.socialImage] },
  };
}

export default async function BranchHome({ params }: { params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);

  const signature = db.select({
    name: menuItems.name, description: menuItems.description, pricePence: menuItems.pricePence,
  }).from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(and(
      eq(menuCategories.branchId, branch.id),
      eq(menuCategories.kind, "food"),
      eq(menuItems.isPublished, true),
      isNotNull(menuItems.pricePence),
    ))
    .orderBy(asc(menuCategories.sort), asc(menuItems.sort)).limit(6).all();

  const rooms = db.select().from(privateRooms)
    .where(and(eq(privateRooms.branchId, branch.id), eq(privateRooms.isPublished, true)))
    .orderBy(asc(privateRooms.sort)).all();

  const collage = db.select().from(galleryImages)
    .where(and(eq(galleryImages.branchId, branch.id), eq(galleryImages.isPublished, true)))
    .orderBy(asc(galleryImages.sort)).limit(5).all();

  const hours = openingHours(branch);

  return (
    <>
      <PageHero
        full
        image={branch.heroImage}
        video={branch.heroVideo}
        kicker={branch.heroKicker}
        heading={branch.heroHeading ?? `Indian fine dining in ${branch.city}`}
        intro={branch.intro}
      >
        <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold">Reserve a table</Link>
        <Link href={pageHref(branch.slug, "menu")} className="btn btn-outline">View the menu</Link>
      </PageHero>


      {/* the about section — heading, copy, and the photo collage the live site runs */}
      <section className="mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-28">
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20 lg:items-center">
          <div>
            <p className="accent text-[0.62rem] text-gold">Our kitchen</p>
            <h2 className="text-3xl sm:text-[2.75rem] mt-4 leading-tight">{branch.aboutHeading}</h2>
            {branch.aboutSubheading && (
              <p className="display text-xl text-gold mt-5">{branch.aboutSubheading}</p>
            )}
            {branch.aboutBody && (
              <p className="mt-6 text-pale/70 leading-relaxed max-w-[52ch]">{branch.aboutBody}</p>
            )}
            <div className="rule my-9" aria-hidden="true">◆</div>

            {/* a taste of the menu, read live from the database */}
            <ul className="grid gap-4">
              {signature.slice(0, 5).map((d) => (
                <li key={d.name}>
                  <div className="leader">
                    <span className="font-semibold">{d.name}</span>
                    <span className="fill" />
                    <span className="tnum">{formatPence(d.pricePence)}</span>
                  </div>
                  {d.description && <p className="text-sm text-pale/70 mt-1 max-w-[46ch]">{d.description}</p>}
                </li>
              ))}
            </ul>
            <Link href={pageHref(branch.slug, "menu")} className="btn btn-ink mt-9">View the full menu</Link>
          </div>

          {/* The collage is the one place on the page where the food is the
              argument, so these are served at a higher quality than Next's
              default 75 and never dimmed. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {(collage.length >= 5 ? collage.map((c) => c.src) : media.collage).slice(0, 5).map((src, i) => (
              <div key={src + i}
                className={`relative overflow-hidden hover-zoom ${i === 0 ? "col-span-2 h-64 sm:h-80" : "h-44 sm:h-56"}`}>
                <Image src={src} alt="" fill quality={90}
                  sizes="(min-width: 1024px) 40vw, 50vw" className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* private dining — only ever this branch's own rooms */}
      {rooms.length > 0 && (
        <section className="bg-ink border-t border-white/5">
          <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-28">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="accent text-[0.62rem] text-gold">Private dining</p>
                <h2 className="text-3xl sm:text-[2.5rem] mt-4 max-w-[26ch] leading-tight">
                  {rooms.length} private {rooms.length === 1 ? "space" : "spaces"} for the occasions that matter
                </h2>
              </div>
              <Link href={pageHref(branch.slug, "private-dining-experiences")} className="btn btn-ink">
                Explore private dining
              </Link>
            </div>

            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.slice(0, 6).map((r) => (
                <li key={r.id} className="bg-ink-2 group border border-white/10">
                  {/* The photograph is lazy-loaded, so give the box a faint
                      gradient rather than flat ink — a card caught mid-load
                      then reads as a card, not a broken image. */}
                  <div className="relative h-56 sm:h-60 overflow-hidden hover-zoom
                                  bg-gradient-to-br from-white/[0.06] to-transparent">
                    {r.image ? (
                      <Image src={r.image} alt={r.name} fill quality={88}
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover" />
                    ) : (
                      /* An empty dark box reads as a broken image. Say what it is. */
                      <div className="absolute inset-0 grid place-items-center border-b border-white/10">
                        <span className="accent text-gold/50">Photograph to follow</span>
                      </div>
                    )}
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl">{r.name}</h3>
                    {r.capacityMax && (
                      <p className="accent text-gold mt-2.5">Up to {r.capacityMax} guests</p>
                    )}
                    {r.tagline && <p className="text-sm text-pale/70 mt-3 leading-relaxed">{r.tagline}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* find us */}
      <section className="mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-24 grid gap-14 lg:grid-cols-2">
        <div>
          <p className="accent text-[0.62rem] text-gold">Find us</p>
          <h2 className="text-3xl mt-4">{branch.addressLine}</h2>
          <address className="not-italic mt-4 text-pale/70 leading-relaxed">
            {branch.city}, {branch.postcode}
          </address>
          <a href={telHref(branch.phone)} className="tnum inline-block mt-5 font-semibold hover:text-gold">
            {branch.phone}
          </a>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold">Make a reservation</Link>
            {branch.mapsUrl && (
              <a href={branch.mapsUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-ink">Open in Google Maps</a>
            )}
          </div>
          <Image src={brand.award} alt={brand.awardAlt} width={130} height={130} className="mt-10 w-[100px] h-auto" />
        </div>
        <div>
          <p className="accent text-[0.62rem] text-gold">Opening hours</p>
          <ul className="mt-5 border-t border-[--line]">
            {hours.map((h) => (
              <li key={h.day} className="flex justify-between py-3 border-b border-[--line] text-sm">
                <span>{h.day}</span>
                <span className="tnum text-pale/70">{h.closed ? "Closed" : `${h.open} – ${h.close}`}</span>
              </li>
            ))}
          </ul>
          {branch.openingNote && <p className="text-xs text-pale/70 mt-4">{branch.openingNote}</p>}
        </div>
      </section>

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
