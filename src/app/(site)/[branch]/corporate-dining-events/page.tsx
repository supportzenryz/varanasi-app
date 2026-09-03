import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { asc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { privateRooms, branchStats } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { bookingRules } from "@/lib/booking-config";
import { pageHref } from "@/lib/nav";
import { PageHero } from "@/components/PageHero";
import { EnquiryForm } from "@/components/EnquiryForm";
import { Sent } from "@/components/Sent";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Corporate Dining & Events",
    description: `Corporate dining and private events at Varanasi ${b.city} — board meetings, product launches, Christmas functions and charity events.`,
    alternates: { canonical: `/${b.slug}/corporate-dining-events` },
  };
}

/** The occasions list from the live page, verbatim. */
const OCCASIONS = [
  "Client-Facing Meetings", "Parties & Functions", "Christmas Meals", "Board Meetings",
  "Conference Calls", "Product Launches", "Charity Events", "Seminars", "Presentations",
];

export default async function Corporate({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);
  const { sent, error } = await searchParams;
  const rules = bookingRules();

  const rooms = db.select({ id: privateRooms.id, name: privateRooms.name })
    .from(privateRooms)
    .where(and(eq(privateRooms.branchId, branch.id), eq(privateRooms.isPublished, true)))
    .orderBy(asc(privateRooms.sort)).all();

  const stats = db.select().from(branchStats)
    .where(eq(branchStats.branchId, branch.id)).orderBy(asc(branchStats.sort)).all();

  return (
    <>
      <PageHero
        image={media.privateDiningHero}
        kicker="Corporate dining & events"
        heading="Book your Corporate Event"
        intro="Private and sophisticated functions, for a brief of any size."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[70rem] px-5 lg:px-10 py-14 sm:py-20">
          <div className="grid gap-8 max-w-[68ch] text-pale/75 leading-relaxed">
            <h2 className="text-2xl sm:text-3xl text-pale">Private &amp; Sophisticated Functions</h2>
            <p>
              As Birmingham&rsquo;s most prominent restaurant at 20,000 sq ft, Varanasi can create unique
              dining experiences for private and corporate events. Our experienced and specialist team
              offers multiple corporate packages, whether for a staff Christmas function or a business
              meeting.
            </p>
            <p>
              Experience corporate fine dining like no other with an exquisite menu at our award-winning
              Indian restaurant. At Varanasi, we understand the importance of producing high-impact
              corporate events. From sophisticated hospitality enclosures to large scale dinners, our team
              are highly experienced at perfecting business events of all sizes for a wide range of
              corporate clients.
            </p>
            <p>
              No brief is too big or small. Whether you are planning an intimate gourmet lunch, an
              eye-catching product launch or a charity event, our team is ready to make it happen.
              Varanasi offers a discreet, highly personal and completely bespoke service. Our menus are
              deliciously different, and we have something to suit all tastes and styles.
            </p>
          </div>

          {/* what they host */}
          <div className="mt-14">
            <span className="accent text-[0.6rem] text-gold">What we host</span>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {OCCASIONS.map((o) => (
                <li key={o} className="border border-[--line] px-4 py-2.5 text-sm">{o}</li>
              ))}
            </ul>
          </div>

          {/* the venue in numbers */}
          {stats.length > 0 && (
            <div className="mt-14 grid gap-px bg-[--line] sm:grid-cols-2 lg:grid-cols-4 border border-[--line]">
              {stats.map((s) => (
                <div key={s.id} className="bg-ink-2 p-6">
                  <span className="block display text-3xl text-gold tnum">{s.value}</span>
                  <span className="block text-sm text-pale/70 mt-1.5">{s.label}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={pageHref(branch.slug, "private-dining-experiences")} className="btn btn-ink">
              See the private rooms
            </Link>
            <Link href={pageHref(branch.slug, "menu")} className="btn btn-outline">Our menu</Link>
          </div>
        </div>
      </section>

      {/* enquiry */}
      <section className="bg-ink border-t border-[--line]">
        <div className="mx-auto max-w-[58rem] px-5 lg:px-10 py-14 sm:py-20">
          <Sent sent={sent === "1"} error={error} />
          <EnquiryForm
            type="corporate"
            branchSlug={branch.slug}
            returnTo={`/${branch.slug}/corporate-dining-events`}
            fields={["phone", "company", "partySize", "date", "time", "room", "dietary"]}
            rooms={rooms}
            occasions={OCCASIONS}
            heading="Tell us about your event"
            intro="The more you can tell us, the better we can plan it. We'll come back to you with options and a quote."
            privacyHref={`/${branch.slug}/privacy`}
            submitLabel="Send enquiry"
            messageLabel="About your event"
            messagePlaceholder="Type of event, timings, budget, anything else we should know…"
          />
        </div>
      </section>
    </>
  );
}
