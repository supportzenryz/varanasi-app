import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { branches, privateRooms, roomImages } from "@/db/schema";
import { branchBySlug, telHref } from "@/lib/branches";
import { formatPence } from "@/lib/money";
import { pageHref, roomHref } from "@/lib/nav";
import { PageHero } from "@/components/PageHero";
import { Panorama } from "@/components/Panorama";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";
import { OrnamentDivider } from "@/components/Ornament";

/**
 * One private room, on its own page.
 *
 * The old site put all eight into a single scroll, which cost the client twice.
 * A couple comparing the Maharaja booth with the Samsara room had to hold both
 * in their head and scroll between them, and — the expensive one — there was no
 * URL for either. Nobody can send "here's the room" to the six people they are
 * organising, and nothing can rank for "private dining room Birmingham" when
 * every room is a fragment of one page about all of them.
 *
 * The listing page keeps its full run-through, so this adds a layer rather than
 * moving anything: the cards there now lead here.
 */

type Params = { branch: string; room: string };

/**
 * Prerender the rooms that exist at build time, as the rest of the public site
 * is prerendered. Rooms added afterwards still work — the segment stays dynamic
 * for anything not listed — so a manager adding a room in the admin does not
 * have to wait for a deploy to see it.
 */
export function generateStaticParams(): Params[] {
  return db.select({ branch: branches.slug, room: privateRooms.slug })
    .from(privateRooms)
    .innerJoin(branches, eq(branches.id, privateRooms.branchId))
    .where(eq(privateRooms.isPublished, true))
    .all();
}

function findRoom(branchSlug: string, roomSlug: string) {
  const branch = branchBySlug(branchSlug);
  if (!branch) return null;
  const room = db.select().from(privateRooms)
    .where(and(
      eq(privateRooms.branchId, branch.id),
      eq(privateRooms.slug, roomSlug),
      eq(privateRooms.isPublished, true),
    )).get();
  return room ? { branch, room } : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { branch: branchSlug, room: roomSlug } = await params;
  const found = findRoom(branchSlug, roomSlug);
  if (!found) return {};
  const { branch, room } = found;
  return {
    title: `${room.name} — Private Dining`,
    description:
      room.tagline
      ?? room.description?.slice(0, 155)
      ?? `${room.name}, a private dining room at Varanasi ${branch.city}.`,
    alternates: { canonical: roomHref(branch.slug, room.slug) },
    openGraph: room.image ? { images: [room.image] } : undefined,
  };
}

function parseIdealFor(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default async function RoomPage({ params }: { params: Promise<Params> }) {
  const { branch: branchSlug, room: roomSlug } = await params;
  const found = findRoom(branchSlug, roomSlug);
  if (!found) notFound();
  const { branch, room } = found;

  const media = db.select().from(roomImages)
    .where(eq(roomImages.roomId, room.id))
    .orderBy(asc(roomImages.sort)).all();
  const panorama = media.find((m) => m.kind === "panorama");
  const photos = media.filter((m) => m.kind === "photo" && m.src !== room.image);

  const siblings = db.select({ id: privateRooms.id, name: privateRooms.name, slug: privateRooms.slug,
    image: privateRooms.image, capacityMax: privateRooms.capacityMax })
    .from(privateRooms)
    .where(and(
      eq(privateRooms.branchId, branch.id),
      eq(privateRooms.isPublished, true),
      ne(privateRooms.id, room.id),
    ))
    .orderBy(asc(privateRooms.sort)).all();

  const facts: { label: string; value: string }[] = [];
  if (room.capacityMax) {
    facts.push({
      label: "Capacity",
      value: room.capacityMin && room.capacityMin !== room.capacityMax
        ? `${room.capacityMin}–${room.capacityMax} guests`
        : `Up to ${room.capacityMax} guests`,
    });
  }
  if (room.depositPerPersonPence) {
    facts.push({ label: "Deposit", value: `${formatPence(room.depositPerPersonPence)} per person` });
  }
  if (room.hireChargePence) facts.push({ label: "Hire charge", value: formatPence(room.hireChargePence) });
  if (room.minSpendPence) facts.push({ label: "Minimum spend", value: formatPence(room.minSpendPence) });
  if (room.exclusivityNote) facts.push({ label: "Exclusivity", value: room.exclusivityNote });
  if (room.setMenuNote) facts.push({ label: "Menu", value: room.setMenuNote });

  const idealFor = parseIdealFor(room.idealFor);

  return (
    <>
      <PageHero
        align="center"
        image={room.image}
        kicker={`Private dining · Varanasi ${branch.city}`}
        heading={room.name}
        intro={room.headline ?? room.tagline}
      >
        <Link href={pageHref(branch.slug, "book-a-private-room")} className="btn btn-gold">
          Enquire about this room
        </Link>
        {panorama && <a href="#look-around" className="btn btn-outline">Look around in 360°</a>}
      </PageHero>

      <section className="mx-auto max-w-[84rem] px-5 lg:px-10 py-16 sm:py-20">
        <div className="grid gap-14 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
          <div>
            {room.description && (
              <p className="text-lg leading-relaxed text-pale/80 max-w-[62ch]">{room.description}</p>
            )}

            {idealFor.length > 0 && (
              <div className="mt-10">
                <p className="accent text-[0.55rem] text-gold">Ideal for</p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {idealFor.map((o) => (
                    <li key={o} className="border border-[--line] bg-ink px-3 py-1.5 text-xs">{o}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-10 flex flex-wrap gap-3">
              <Link href={pageHref(branch.slug, "book-a-private-room")} className="btn btn-gold">
                Enquire about this room
              </Link>
              <Link href={pageHref(branch.slug, "menu")} className="btn btn-ink">View set menus</Link>
            </div>

            {/* A room this size is usually settled on the telephone. Saying so,
                with the number, beats making them find the contact page. */}
            <p className="mt-6 text-sm text-pale/60">
              Or talk it through with us on{" "}
              <a href={telHref(branch.phone)} className="tnum font-semibold text-pale hover:text-gold">
                {branch.phone}
              </a>.
            </p>
          </div>

          {facts.length > 0 && (
            <aside className="lg:pl-10 lg:border-l lg:border-[--line]">
              <p className="accent text-[0.55rem] text-gold">The details</p>
              <dl className="mt-5 border-t border-[--line]">
                {facts.map((f) => (
                  <div key={f.label} className="flex gap-4 border-b border-[--line] py-3.5 text-sm">
                    <dt className="accent w-28 shrink-0 pt-1 text-[0.52rem] text-pale/45">{f.label}</dt>
                    <dd className="flex-1">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          )}
        </div>
      </section>

      {panorama && (
        <section id="look-around" className="scroll-mt-24 border-t border-white/5 bg-ink-2">
          <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-16 sm:py-20">
            <header className="mx-auto max-w-[42ch] text-center">
              <p className="accent text-[0.62rem] text-gold">Look around</p>
              <h2 className="mt-4 text-3xl sm:text-4xl">Stand in the {room.name}</h2>
              <OrnamentDivider className="mt-6" />
              <p className="mt-6 text-sm leading-relaxed text-pale/70">
                Drag to turn, scroll or pinch to move closer. On a phone, full screen is
                the one worth using.
              </p>
            </header>
            <Panorama
              src={panorama.src}
              label={panorama.alt ?? `${room.name} at Varanasi ${branch.city}`}
              headingDeg={panorama.headingDeg}
              className="mt-10 h-[62svh] min-h-[22rem] w-full border border-white/10"
            />
          </div>
        </section>
      )}

      {photos.length > 0 && (
        <section className="mx-auto max-w-[84rem] px-5 lg:px-10 py-16 sm:py-20">
          <p className="accent text-[0.62rem] text-gold">The room</p>
          <ul className="mt-8 grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id} className="hover-zoom relative h-60 overflow-hidden sm:h-72">
                <Image src={p.src} alt={p.alt ?? room.name} fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {siblings.length > 0 && (
        <section className="border-t border-white/5 bg-ink-2">
          <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-16 sm:py-20">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <h2 className="text-2xl sm:text-3xl">The other spaces</h2>
              <Link href={pageHref(branch.slug, "private-dining-experiences")} className="btn btn-ink">
                All private dining
              </Link>
            </div>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {siblings.map((s) => (
                <li key={s.id}>
                  <Link href={roomHref(branch.slug, s.slug)} className="group block border border-white/10 bg-ink">
                    <span className="hover-zoom relative block h-40 overflow-hidden
                                     bg-gradient-to-br from-white/[0.06] to-transparent">
                      {s.image && (
                        <Image src={s.image} alt="" fill sizes="(min-width: 640px) 25vw, 100vw"
                          className="object-cover" />
                      )}
                    </span>
                    <span className="block p-4">
                      <span className="block text-base transition-colors group-hover:text-gold">{s.name}</span>
                      {s.capacityMax && (
                        <span className="accent mt-2 block text-[0.52rem] text-gold/80">
                          Up to {s.capacityMax} guests
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
