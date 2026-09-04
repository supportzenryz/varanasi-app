import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { privateRooms } from "@/db/schema";
import { branchBySlug, telHref } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { bookingRules } from "@/lib/booking-config";
import { formatPence } from "@/lib/money";
import { pageHref } from "@/lib/nav";
import { PageHero } from "@/components/PageHero";
import { EnquiryForm } from "@/components/EnquiryForm";
import { Sent } from "@/components/Sent";
import { recallSubmission } from "@/lib/form-recall";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Book a Private Room",
    description: `Enquire about a private room at Varanasi ${b.city} — capacities, deposits and set menus.`,
    alternates: { canonical: `/${b.slug}/book-a-private-room` },
  };
}

/**
 * The room enquiry, and the one place the old site's worst bug lived: Leicester's
 * form offered Birmingham's seven rooms. This list comes from the branch's own
 * rooms, so it cannot happen again.
 */
export default async function BookPrivateRoom({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ sent?: string; error?: string; room?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);
  const { sent, error } = await searchParams;
  /* The rejected submission, if there was one: the message and everything
     typed, from a short-lived cookie rather than the query string. */
  const recalled = error ? await recallSubmission(`/${branch.slug}/book-a-private-room`) : null;
  const rules = bookingRules();

  const rooms = db.select().from(privateRooms)
    .where(and(eq(privateRooms.branchId, branch.id), eq(privateRooms.isPublished, true)))
    .orderBy(asc(privateRooms.sort)).all();

  return (
    <>
      <PageHero
        image={media.privateDiningHero}
        kicker="Private dining"
        heading="Book a Private Room"
        intro={`${rooms.length} private ${rooms.length === 1 ? "space" : "spaces"} at Varanasi ${branch.city}. Tell us the occasion and we'll match you to the right room.`}
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[70rem] px-5 lg:px-10 py-14 sm:py-20 grid gap-14 lg:grid-cols-[0.85fr_1fr]">
          {/* the rooms, so people can choose knowingly */}
          <div>
            <span className="accent text-[0.6rem] text-gold">The spaces</span>
            <ul className="mt-5 grid gap-5">
              {rooms.map((r) => (
                <li key={r.id} className="border-b border-[--line] pb-4 last:border-0">
                  <span className="block">{r.name}</span>
                  <span className="block text-sm text-pale/70 mt-1 tnum">
                    {r.capacityMax ? `Up to ${r.capacityMax} guests` : "Capacity on request"}
                    {r.hireChargePence != null && ` · hire ${formatPence(r.hireChargePence)}`}
                    {r.depositPerPersonPence != null && ` · ${formatPence(r.depositPerPersonPence)} pp deposit`}
                  </span>
                  {r.setMenuNote && (
                    <span className="block text-xs text-pale/45 mt-1">{r.setMenuNote}</span>
                  )}
                </li>
              ))}
            </ul>
            <Link href={pageHref(branch.slug, "private-dining-experiences")}
              className="text-sm underline hover:text-gold mt-6 inline-block">
              See photographs and full descriptions
            </Link>
            <p className="mt-8 text-sm text-pale/70">
              Prefer to talk it through?{" "}
              <a href={telHref(branch.phone)} className="underline hover:text-gold tnum">{branch.phone}</a>
            </p>
          </div>

          <div className="border border-[--line] bg-ink-2 px-5 sm:px-8 py-8">
            <Sent sent={sent === "1"} error={recalled?.message ?? (error ? "Something wasn't quite right — please check the form below." : undefined)} />
            <EnquiryForm
              values={recalled?.values ?? {}}
              type="private_room"
              branchSlug={branch.slug}
              returnTo={`/${branch.slug}/book-a-private-room`}
              fields={["phone", "partySize", "date", "time", "occasion", "room", "dietary"]}
              rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
              occasions={rules.occasions.options}
              heading="Room enquiry"
              intro="Send us the details and we'll confirm availability, the deposit and the set menu options."
              privacyHref={`/${branch.slug}/privacy`}
              messageLabel="Anything else?"
              messagePlaceholder="Timings, a cake, decorations, seating preferences…"
            />
          </div>
        </div>
      </section>
    </>
  );
}
