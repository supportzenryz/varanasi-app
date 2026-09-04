import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allBranches, branchBySlug, openingHours, telHref } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { bookingRules } from "@/lib/booking-config";
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
    title: "Contact Us",
    description: `Contact Varanasi ${b.city} — ${b.addressLine}, ${b.postcode}. Call ${b.phone} or send us a message.`,
    alternates: { canonical: `/${b.slug}/contact` },
  };
}

/** Groups consecutive days sharing the same hours, as the live page writes them. */
function grouped(hours: ReturnType<typeof openingHours>) {
  const out: { label: string; value: string }[] = [];
  for (const h of hours) {
    const value = h.closed ? "Closed" : `${h.open} – ${h.close}`;
    const last = out[out.length - 1];
    const short = h.day.slice(0, 3);
    if (last && last.value === value) last.label = `${last.label.split(" – ")[0]} – ${short}`;
    else out.push({ label: short, value });
  }
  return out;
}

export default async function Contact({
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
  /* The rejected submission, if there was one: the message and everything
     typed, from a short-lived cookie rather than the query string. */
  const recalled = error ? await recallSubmission(`/${branch.slug}/contact`) : null;
  const rules = bookingRules();
  const others = allBranches().filter((b) => b.id !== branch.id);
  const hours = grouped(openingHours(branch));

  return (
    <>
      <PageHero
        image={media.privateDiningHero}
        kicker="Contact"
        heading="Contact Us"
        intro="For all enquiries or table bookings, please use the details below — or send us a message and we'll come straight back to you."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-14 sm:py-20 grid gap-14 lg:grid-cols-[1fr_1.1fr]">
          {/* details */}
          <div>
            <span className="accent text-[0.6rem] text-gold">Varanasi {branch.city}</span>
            <h2 className="text-3xl mt-3">{branch.city}</h2>

            <dl className="mt-8 grid gap-7">
              <div>
                <dt className="accent text-[0.58rem] text-gold">Call us</dt>
                <dd className="mt-1.5 text-xl tnum">
                  <a href={telHref(branch.phone)} className="hover:text-gold">{branch.phone}</a>
                </dd>
              </div>
              {branch.bookingEmail && (
                <div>
                  <dt className="accent text-[0.58rem] text-gold">Table reservations</dt>
                  <dd className="mt-1.5">
                    <a href={`mailto:${branch.bookingEmail}`} className="hover:text-gold underline">
                      {branch.bookingEmail}
                    </a>
                  </dd>
                </div>
              )}
              {branch.pressEmail && (
                <div>
                  <dt className="accent text-[0.58rem] text-gold">Press &amp; private dining</dt>
                  <dd className="mt-1.5">
                    <a href={`mailto:${branch.pressEmail}`} className="hover:text-gold underline">
                      {branch.pressEmail}
                    </a>
                  </dd>
                </div>
              )}
              <div>
                <dt className="accent text-[0.58rem] text-gold">Location</dt>
                <dd className="mt-1.5">
                  <address className="not-italic leading-relaxed">
                    {branch.addressLine}<br />{branch.city}, {branch.postcode}
                  </address>
                  {branch.mapsUrl && (
                    <a href={branch.mapsUrl} target="_blank" rel="noreferrer noopener"
                      className="text-sm underline hover:text-gold mt-2 inline-block">
                      Open in Google Maps
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt className="accent text-[0.58rem] text-gold">Opening hours</dt>
                <dd className="mt-1.5">
                  <ul className="grid gap-1.5 max-w-[16rem]">
                    {hours.map((h) => (
                      <li key={h.label} className="flex justify-between gap-4">
                        <span>{h.label}</span>
                        <span className="tnum text-pale/70">{h.value}</span>
                      </li>
                    ))}
                  </ul>
                  {branch.openingNote && (
                    <p className="text-xs text-pale/45 mt-2">{branch.openingNote}</p>
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold">Make a reservation</Link>
            </div>

            {others.length > 0 && (
              <div className="mt-12 pt-8 border-t border-[--line]">
                <span className="accent text-[0.6rem] text-gold">Our other restaurant</span>
                {others.map((b) => (
                  <div key={b.id} className="mt-4">
                    <Link href={`/${b.slug}/contact`} className="text-lg hover:text-gold">
                      Varanasi {b.city}
                    </Link>
                    <p className="text-sm text-pale/70 mt-1">
                      {b.addressLine}, {b.postcode} ·{" "}
                      <a href={telHref(b.phone)} className="tnum hover:text-gold">{b.phone}</a>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* form */}
          <div className="border border-[--line] bg-ink-2 px-5 sm:px-8 py-8">
            <Sent sent={sent === "1"} error={recalled?.message ?? (error ? "Something wasn't quite right — please check the form below." : undefined)} />
            <EnquiryForm
              values={recalled?.values ?? {}}
              type="contact"
              branchSlug={branch.slug}
              returnTo={`/${branch.slug}/contact`}
              fields={["phone"]}
              heading="Send us a message"
              intro="We answer every message personally, usually within one working day."
              privacyHref={`/${branch.slug}/privacy`}
              messagePlaceholder="How can we help?"
            />
          </div>
        </div>
      </section>
    </>
  );
}
