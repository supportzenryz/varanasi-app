import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { privateRooms } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { formatPence } from "@/lib/money";
import { pageHref } from "@/lib/nav";
import { branchMedia } from "@/lib/brand";
import { PageHero } from "@/components/PageHero";
import { GiftVoucherBand } from "@/components/GiftVoucherBand";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Private Dining",
    description: `Private dining rooms and exclusive spaces at Varanasi ${b.city}.`,
    alternates: { canonical: `/${b.slug}/private-dining-experiences` },
  };
}

const OCCASIONS = [
  "Formal Corporate Dinners",
  "Awards Ceremonies",
  "Meetings and Conferences",
  "Intimate Wedding Celebrations",
  "Milestone Birthdays",
  "Anniversaries and Proposals",
  "Charity Fundraisers",
];

function parseIdealFor(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default async function PrivateDiningPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);

  const rooms = db.select().from(privateRooms)
    .where(and(eq(privateRooms.branchId, branch.id), eq(privateRooms.isPublished, true)))
    .orderBy(asc(privateRooms.sort)).all();

  return (
    <>
      <PageHero
        align="center"
        image={media.privateDiningHero}
        kicker={`Varanasi ${branch.city}`}
        heading="Private Dining"
        intro="Creating luxurious, intimate and memorable events."
      >
        <a href="#rooms" className="btn btn-gold">View private rooms</a>
        <Link href={pageHref(branch.slug, "book-a-private-room")} className="btn btn-outline">Enquire</Link>
      </PageHero>

      <section className="mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-24">
        <div className="grid gap-14 lg:grid-cols-[1.3fr_1fr] lg:gap-20">
          <div>
            <p className="accent text-[0.62rem] text-gold">Private dining experiences</p>
            <h2 className="text-3xl sm:text-[2.5rem] mt-4 leading-tight max-w-[24ch]">
              Creating luxurious, intimate &amp; memorable events
            </h2>
            <div className="mt-7 grid gap-5 text-pale/70 leading-relaxed max-w-[62ch]">
              <p>
                At Varanasi we take pride in offering an exceptional selection of private dining spaces designed to
                elevate every occasion. {rooms.length > 2
                  ? `Our ${rooms.length} exclusive rooms and sections provide`
                  : "Our private rooms provide"} the perfect setting for guests seeking a refined, secluded and
                memorable dining experience. Each room features distinctive décor and ambience that reflect the
                elegance and grandeur of Varanasi.
              </p>
              <p>
                Whether you are hosting a corporate function, celebrating a milestone, or planning an intimate
                gathering, our private dining experiences are fully versatile and can be tailored to your
                specific requirements.
              </p>
            </div>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href={pageHref(branch.slug, "book-a-private-room")} className="btn btn-gold">
                Book a private room
              </Link>
              <Link href={pageHref(branch.slug, "contact")} className="btn btn-ink">Contact us</Link>
            </div>
          </div>

          <div>
            <p className="accent text-[0.62rem] text-gold">Ideal for</p>
            <ul className="mt-5 border-t border-[--line]">
              {OCCASIONS.map((o) => (
                <li key={o} className="py-3 border-b border-[--line] text-sm flex gap-3">
                  <span className="text-gold-deep" aria-hidden="true">◆</span>
                  {o}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="rooms" className="bg-ink-2 scroll-mt-24">
        <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-24">
          <header className="text-center max-w-[40ch] mx-auto">
            <p className="accent text-[0.62rem] text-gold">Private rooms to hire</p>
            <h2 className="text-3xl sm:text-4xl mt-4">
              {rooms.length} {rooms.length === 1 ? "space" : "spaces"}, each with its own character
            </h2>
            <div className="rule mt-6" aria-hidden="true">◆</div>
          </header>

          <div className="mt-16 grid gap-16 sm:gap-20">
            {rooms.map((room, i) => {
              const idealFor = parseIdealFor(room.idealFor);
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
              if (room.hireChargePence) {
                facts.push({ label: "Hire charge", value: formatPence(room.hireChargePence) });
              }
              if (room.exclusivityNote) facts.push({ label: "Exclusivity", value: room.exclusivityNote });
              if (room.setMenuNote) facts.push({ label: "Menu", value: room.setMenuNote });

              return (
                <article key={room.id} id={room.slug}
                  className="grid gap-8 lg:grid-cols-2 lg:gap-14 lg:items-center scroll-mt-28">
                  <div className={`relative h-72 sm:h-96 overflow-hidden hover-zoom ${i % 2 ? "lg:order-2" : ""}`}>
                    {room.image ? (
                      <Image src={room.image} alt={room.name} fill sizes="(min-width: 1024px) 50vw, 100vw"
                        className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-ink/10 flex items-center justify-center">
                        <span className="accent text-[0.6rem] text-pale/70">Photograph to follow</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-2xl sm:text-[2rem] leading-tight">{room.name}</h3>
                    {room.headline && (
                      <p className="display italic text-lg text-gold mt-3">{room.headline}</p>
                    )}

                    {facts.length > 0 && (
                      <dl className="mt-6 grid gap-2 text-sm border-t border-[--line] pt-5">
                        {facts.map((f) => (
                          <div key={f.label} className="flex gap-3">
                            <dt className="accent text-[0.52rem] text-pale/45 w-24 shrink-0 pt-1">{f.label}</dt>
                            <dd className="flex-1">{f.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {room.description && (
                      <p className="mt-6 text-sm text-pale/70 leading-relaxed max-w-[58ch]">{room.description}</p>
                    )}

                    {idealFor.length > 0 && (
                      <div className="mt-6">
                        <p className="accent text-[0.52rem] text-pale/45">Ideal for</p>
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {idealFor.map((o) => (
                            <li key={o} className="text-xs border border-[--line] px-3 py-1.5 bg-ink">{o}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-8 flex flex-wrap gap-3">
                      <Link href={pageHref(branch.slug, "book-a-private-room")} className="btn btn-gold">
                        Book this room
                      </Link>
                      <Link href={pageHref(branch.slug, "menu")} className="btn btn-ink">View set menus</Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {rooms.length === 0 && (
            <p className="text-center text-pale/70 mt-10">
              Private dining details for this restaurant are being confirmed. Please{" "}
              <Link href={pageHref(branch.slug, "contact")} className="underline hover:text-gold">contact us</Link>{" "}
              and we will talk you through the options.
            </p>
          )}
        </div>
      </section>

      <GiftVoucherBand branchSlug={branch.slug} />
    </>
  );
}
