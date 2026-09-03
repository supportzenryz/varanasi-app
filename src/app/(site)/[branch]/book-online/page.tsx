import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { bookingRules, prettyTime, depositFor } from "@/lib/booking-config";
import { availabilityFor } from "@/lib/availability";
import { expireStaleHolds, dateLabel } from "@/lib/booking";
import { formatPence } from "@/lib/money";
import { PageHero } from "@/components/PageHero";
import { startBooking } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Reservations",
    description: `Book a table at Varanasi ${b.city}. Choose your date and time, and confirm instantly.`,
    alternates: { canonical: `/${b.slug}/book-online` },
  };
}

const field =
  "w-full border border-[--line] bg-ink-2 px-3.5 py-3 text-[0.95rem] outline-none focus:border-gold rounded-none";
const label = "block accent text-[0.6rem] text-gold mb-2";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** The three steps are driven by the URL, so Back works and a slot can be shared. */
export default async function BookOnline({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ guests?: string; date?: string; time?: string; error?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);
  const rules = bookingRules();

  const sp = await searchParams;
  const guests = sp.guests ? Number(sp.guests) : null;
  const date = sp.date || null;
  const chosenTime = sp.time || null;

  // an abandoned checkout shouldn't keep a table off the list
  expireStaleHolds();

  const step = chosenTime && guests && date ? 3 : guests && date ? 2 : 1;
  const availability = step >= 2 && guests && date ? availabilityFor(branch, date, guests, rules) : null;
  const deposit = guests && date ? depositFor(rules, date, guests) : 0;

  const partyOptions = Array.from({ length: rules.capacity.maxPartyOnline }, (_, i) => i + 1);
  const here = `/${branch.slug}/book-online`;

  return (
    <>
      <PageHero
        image={media.privateDiningHero ?? branch.heroImage}
        kicker="Reservations"
        heading={`Book a table at Varanasi ${branch.city}`}
        intro={`A ${formatPence(rules.deposit.perPersonPence)} per person deposit confirms your table, and comes straight off your bill.`}
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[64rem] px-5 lg:px-10 py-14 sm:py-20">
          {/* progress */}
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.7rem] accent">
            {["When", "Time", "Your details", "Payment"].map((s, i) => {
              const n = i + 1;
              const done = n < step;
              const current = n === step;
              return (
                <li key={s} className="flex items-center gap-3">
                  <span className={`flex items-center gap-2 ${current ? "text-pale" : done ? "text-gold" : "text-pale/35"}`}>
                    <span className={`grid place-items-center w-6 h-6 rounded-full text-[0.65rem] ${
                      current ? "bg-ink text-pale" : done ? "bg-gold text-pale" : "border border-[--line]"}`}>
                      {done ? "✓" : n}
                    </span>
                    {s}
                  </span>
                  {i < 3 && <span className="w-6 h-px bg-[--line]" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>

          {sp.error && (
            <p role="alert" className="mt-8 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
              {sp.error}
            </p>
          )}

          {/* ---------- step 1: party size and date ---------- */}
          <div className="mt-8 border border-[--line] bg-ink-2">
            <div className="px-5 sm:px-8 py-7">
              <h2 className="text-2xl sm:text-3xl">How many, and when?</h2>
              <form method="GET" action={here} className="mt-6 grid gap-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <label className={label} htmlFor="guests">Guests</label>
                  <select id="guests" name="guests" defaultValue={guests ?? 2} className={field}>
                    {partyOptions.map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="date">Date</label>
                  <input id="date" name="date" type="date" required
                    min={todayISO()} defaultValue={date ?? todayISO()} className={field} />
                </div>
                <button className="btn btn-ink w-full sm:w-auto">
                  {step === 1 ? "Find a table" : "Update"}
                </button>
              </form>
              <p className="mt-4 text-xs text-pale/70">
                Booking for more than {rules.capacity.maxPartyOnline}?{" "}
                <a href={telHref(branch.phone)} className="underline hover:text-gold">
                  Call us on {branch.phone}
                </a>{" "}
                and we'll arrange it personally.
              </p>
            </div>

            {/* ---------- step 2: the slot picker ---------- */}
            {availability && (
              <div className="border-t border-[--line] px-5 sm:px-8 py-7 bg-ink-2/[0.02]">
                <h2 className="text-2xl sm:text-3xl">
                  {chosenTime ? "Your table" : "Choose a time"}
                </h2>
                <p className="mt-1.5 text-sm text-pale/70">
                  {dateLabel(availability.date)} · {guests} {guests === 1 ? "guest" : "guests"}
                </p>

                {availability.closed && availability.slots.length === 0 ? (
                  <p className="mt-5 text-sm border-l-2 border-gold bg-gold/10 px-4 py-3">{availability.closed}</p>
                ) : (
                  <>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {availability.slots.map((s) => {
                        const active = chosenTime === s.time;
                        if (!s.available) {
                          return (
                            <span key={s.time} aria-disabled="true"
                              className="px-4 py-2.5 text-sm text-pale/25 border border-[--line] line-through cursor-not-allowed">
                              {prettyTime(s.time)}
                            </span>
                          );
                        }
                        return (
                          <Link key={s.time}
                            href={`${here}?guests=${guests}&date=${availability.date}&time=${s.time}`}
                            aria-current={active ? "true" : undefined}
                            className={`px-4 py-2.5 text-sm border transition-colors ${
                              active
                                ? "bg-ink text-pale border-ink"
                                : "bg-ink-2 border-[--line] hover:border-gold hover:text-gold"}`}>
                            {prettyTime(s.time)}
                          </Link>
                        );
                      })}
                    </div>
                    {availability.closed && (
                      <p className="mt-4 text-xs text-pale/70">{availability.closed}</p>
                    )}
                    <p className="mt-4 text-xs text-pale/70">
                      Crossed-out times are fully booked or too close to the sitting.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* ---------- step 3: details, then payment ---------- */}
            {step === 3 && guests && date && chosenTime && (
              <div className="border-t border-[--line] px-5 sm:px-8 py-7">
                <h2 className="text-2xl sm:text-3xl">Your details</h2>
                <p className="mt-1.5 text-sm text-pale/70">
                  {dateLabel(date)} at {prettyTime(chosenTime)} · {guests} {guests === 1 ? "guest" : "guests"}
                </p>

                <form action={startBooking} className="mt-7 grid gap-6">
                  <input type="hidden" name="branch" value={branch.slug} />
                  <input type="hidden" name="date" value={date} />
                  <input type="hidden" name="time" value={chosenTime} />
                  <input type="hidden" name="guests" value={guests} />

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label className={label} htmlFor="name">Name</label>
                      <input id="name" name="name" required autoComplete="name" className={field} />
                    </div>
                    <div>
                      <label className={label} htmlFor="phone">Phone</label>
                      <input id="phone" name="phone" type="tel" required autoComplete="tel" className={field} />
                    </div>
                    <div>
                      <label className={label} htmlFor="email">Email</label>
                      <input id="email" name="email" type="email" required autoComplete="email" className={field} />
                      <span className="block text-xs text-pale/70 mt-1.5">Your confirmation goes here.</span>
                    </div>
                    <div>
                      <label className={label} htmlFor="occasion">Occasion</label>
                      <select id="occasion" name="occasion" className={field} defaultValue={rules.occasions.options[0]}>
                        {rules.occasions.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>

                  <fieldset>
                    <legend className={label}>Allergies in the party</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                      {rules.allergens.options.map((a) => (
                        <label key={a} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="allergens" value={a} /> {a}
                        </label>
                      ))}
                    </div>
                    <span className="block text-xs text-pale/70 mt-2.5">
                      Tick anything we should know about and the kitchen will be told.
                    </span>
                  </fieldset>

                  <div>
                    <label className={label} htmlFor="notes">Anything else?</label>
                    <textarea id="notes" name="notes" rows={3} className={field}
                      placeholder="Seating preferences, a cake, a wheelchair space…" />
                  </div>

                  {/* the deposit, stated plainly before they commit */}
                  <div className="border border-gold/40 bg-gold/8 px-4 py-4">
                    <p className="text-sm">
                      <span className="accent text-[0.6rem] text-gold block mb-1.5">Deposit</span>
                      {deposit > 0 ? (
                        <>
                          <strong className="tnum">{formatPence(deposit)}</strong>{" "}
                          ({formatPence(rules.deposit.perPersonPence)} × {guests} {guests === 1 ? "guest" : "guests"})
                          is payable now to confirm the table. {rules.deposit.note}
                        </>
                      ) : (
                        <>No deposit is needed for this booking.</>
                      )}
                    </p>
                  </div>

                  <fieldset className="grid gap-3">
                    <legend className={label}>Please confirm</legend>
                    <label className="flex gap-3 text-sm items-start">
                      <input type="checkbox" name="terms" required className="mt-1" />
                      <span>{rules.consents.terms}</span>
                    </label>
                    {deposit > 0 && (
                      <>
                        <label className="flex gap-3 text-sm items-start">
                          <input type="checkbox" name="depositTerms" required className="mt-1" />
                          <span>{rules.consents.deposit}</span>
                        </label>
                        <label className="flex gap-3 text-sm items-start">
                          <input type="checkbox" name="depositRate" required className="mt-1" />
                          <span>{rules.consents.depositRate}</span>
                        </label>
                      </>
                    )}
                    <label className="flex gap-3 text-sm items-start">
                      <input type="checkbox" name="marketing" className="mt-1" />
                      <span>{rules.consents.marketing}</span>
                    </label>
                  </fieldset>

                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <button className="btn btn-gold">
                      {deposit > 0 ? `Pay ${formatPence(deposit)} and confirm` : "Confirm booking"}
                    </button>
                    <span className="text-xs text-pale/70">
                      {deposit > 0
                        ? "You'll be taken to our secure payment page. Your table isn't confirmed until payment succeeds."
                        : "Your table is confirmed straight away."}
                    </span>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* the house rules, once, at the bottom */}
          <div className="mt-10 grid gap-6 sm:grid-cols-3 text-sm text-pale/70">
            <p>
              <span className="accent text-[0.6rem] text-gold block mb-1.5">Deposits</span>
              {formatPence(rules.deposit.perPersonPence)} per person, deducted from your bill. Non-refundable, but
              move your booking with 24 hours' notice.
            </p>
            <p>
              <span className="accent text-[0.6rem] text-gold block mb-1.5">Large parties</span>
              More than {rules.capacity.maxPartyOnline} guests, or a private room? Call {branch.phone} or see{" "}
              <Link href={`/${branch.slug}/private-dining-experiences`} className="underline hover:text-gold">
                private dining
              </Link>.
            </p>
            <p>
              <span className="accent text-[0.6rem] text-gold block mb-1.5">Opening</span>
              Sittings from {prettyTime(rules.slots.first)} to {prettyTime(rules.slots.last)}.
              {branch.openingNote ? ` ${branch.openingNote}` : ""}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
