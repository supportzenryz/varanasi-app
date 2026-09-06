import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { galleryImages, menuCategories, menuItems, privateRooms } from "@/db/schema";
import { branchBySlug, openingHours, telHref } from "@/lib/branches";
import { formatPence } from "@/lib/money";
import { pageHref, roomHref } from "@/lib/nav";
import { brand, branchMedia } from "@/lib/brand";
import { HomeHero } from "@/components/HomeHero";
import { BranchBand } from "@/components/BranchBand";
import { MenuStacks } from "@/components/MenuStacks";
import { VerticalFilm } from "@/components/VerticalFilm";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";
import { OrnamentDivider, JaliBand } from "@/components/Ornament";

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

  /* The four menus the home page offers as panels. A la carte and drinks are
     whole pages; the two set menus are anchors on the menu page, and the
     anchors are the category slugs MenuList already emits, so these cannot
     drift apart from the menu itself without the link visibly breaking. */
  const menuArt = media.menuBanners;
  const stacks = [
    { label: "A La Carte", href: pageHref(branch.slug, "menu"), image: menuArt[0] ?? media.menuHero },
    { label: "Set Menus", href: `${pageHref(branch.slug, "menu")}#shahi-set-menu`, image: menuArt[1] ?? media.menuHero },
    { label: "Vegetarian", href: `${pageHref(branch.slug, "menu")}#vegetarian-set-menu`, image: menuArt[2] ?? media.menuHero },
    { label: "Drinks & Cocktails", href: pageHref(branch.slug, "drinks"), image: media.drinksHero },
  ];

  return (
    <>
      <HomeHero image={branch.heroImage} video={branch.heroVideo} city={branch.city} />

      {/* The city moved here when the hero was cut to one line — see BranchBand. */}
      <BranchBand city={branch.city} />

      {/* The four menus, as tall panels. Placed above the about section because
          this is what most people arrive wanting: on the old site the menu was
          three scrolls down and the most-clicked link in the header. */}
      <section className="reveal mx-auto max-w-[84rem] px-5 lg:px-10 pt-14 sm:pt-16">
        {/* Held to a column rather than the full width: the jali unit is
            24px wide and stretching it across 1,300px turns a lattice into
            four faint scratches. */}
        <JaliBand className="opacity-45 mb-12 mx-auto max-w-md" />
        <header className="text-center">
          <p className="accent text-[0.62rem] text-gold">The menus</p>
          <h2 className="text-3xl sm:text-[2.5rem] mt-4">A dynamic menu that celebrates heritage</h2>
        </header>
        <div className="mt-10 sm:mt-12">
          <MenuStacks stacks={stacks} />
        </div>
      </section>


      {/* The food film. It sits between the menus and the kitchen copy because
          that is the join it bridges: the panels above say what is served, the
          section below says how it is cooked, and thirty seconds of a table
          being laid is the argument neither of them can make in words. */}
      {media.filmVideo && (
        <VerticalFilm
          src={media.filmVideo}
          poster={media.filmPoster}
          kicker="At the table"
          heading="Thirty seconds in the dining room"
          body="Small plates, open flames and a room lit for the evening. This is a
                service at Varanasi as it actually looks — no styling, no stand-ins."
        >
          <Link href={pageHref(branch.slug, "menu")} className="btn btn-gold">See the menu</Link>
          <Link href={pageHref(branch.slug, "gallery")} className="btn btn-ink">More photographs</Link>
        </VerticalFilm>
      )}

      {/* the about section — heading, copy, and the photo collage the live site runs */}
      <section className="reveal mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-28">
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
            <OrnamentDivider className="my-9" />

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
                className={`relative overflow-hidden hover-zoom framed warm ${i === 0 ? "col-span-2 h-64 sm:h-80" : "h-44 sm:h-56"}`}>
                <Image src={src} alt="" fill quality={90}
                  sizes="(min-width: 1024px) 40vw, 50vw" className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* private dining — only ever this branch's own rooms */}
      {rooms.length > 0 && (
        <section className="reveal bg-ink border-t border-white/5">
          {/* A pierced screen where a plain border was: the section this
              introduces is about rooms, so an architectural motif earns its place. */}
          <JaliBand className="opacity-70" />
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
                <li key={r.id} className="group border border-white/10 bg-ink-2">
                  {/* The whole card is the link. A photograph of a room that
                      does nothing when you click it is the single most common
                      thing a visitor tries on this section. */}
                  <Link href={roomHref(branch.slug, r.slug)} className="block">
                    {/* The photograph is lazy-loaded, so give the box a faint
                        gradient rather than flat ink — a card caught mid-load
                        then reads as a card, not a broken image. */}
                    <span className="hover-zoom warm relative block h-56 overflow-hidden
                                     bg-gradient-to-br from-white/[0.06] to-transparent sm:h-60">
                      {r.image ? (
                        <Image src={r.image} alt={r.name} fill quality={88}
                          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover" />
                      ) : (
                        /* An empty dark box reads as a broken image. Say what it is. */
                        <span className="absolute inset-0 grid place-items-center border-b border-white/10">
                          <span className="accent text-gold/50">Photograph to follow</span>
                        </span>
                      )}
                    </span>
                    <span className="block p-6">
                      <h3 className="text-xl transition-colors group-hover:text-gold">{r.name}</h3>
                      {r.capacityMax && (
                        <span className="accent mt-2.5 block text-gold">Up to {r.capacityMax} guests</span>
                      )}
                      {r.tagline && (
                        <span className="mt-3 block text-sm leading-relaxed text-pale/70">{r.tagline}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* find us */}
      <section className="reveal mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-24 grid gap-14 lg:grid-cols-2">
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
