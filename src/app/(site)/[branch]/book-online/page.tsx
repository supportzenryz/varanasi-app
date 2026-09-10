import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { bookingRules, prettyTime, depositFor } from "@/lib/booking-config";
import { availabilityFor, calendarFor, nextOpenDay } from "@/lib/availability";
import { expireStaleHolds, dateLabel } from "@/lib/booking";
import { formatPence } from "@/lib/money";
import { PageHero } from "@/components/PageHero";
import { startBooking } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingCalendar } from "@/components/BookingCalendar";
import { recallSubmission, recalledList } from "@/lib/form-recall";
import { choice, choiceText, field, label } from "@/lib/forms";

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


/** The three steps are driven by the URL, so Back works and a slot can be shared. */
export default async function BookOnline({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ guests?: string; date?: string; time?: string; error?: string; focus?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);
  const rules = bookingRules();

  const sp = await searchParams;

  /* What the guest typed last time, when the last time was a rejection.
     Asked for only when the URL says a submission was just refused, because
     the cookie is set for the whole site and lives for a minute. */
  const recalled = sp.error ? await recallSubmission(`/${branch.slug}/book-online`) : null;
  const was = (name: string) => recalled?.values[name] ?? "";
  const wasChecked = (name: string, value: string) =>
    recalled ? recalledList(recalled.values, name).includes(value) : false;
  /* Which box to put the cursor in. `autoFocus` on a server-rendered input is
     a real HTML attribute, so the browser scrolls to it and focuses it before
     any JavaScript runs — which is the whole point on the slowest phone on the
     worst connection, at the moment someone is trying to give us money. */
  const focus = recalled ? sp.focus : undefined;
  const guests = sp.guests ? Number(sp.guests) : null;
  const date = sp.date || null;
  const chosenTime = sp.time || null;

  // an abandoned checkout shouldn't keep a table off the list
  expireStaleHolds();

  /* The calendar's own view of the next three months, for this party size.
     Drawn from the same rules the booking enforces, so a day the guest can
     press is a day the booking will accept. */
  const party = guests ?? rules.capacity.minPartyOnline + 1;
  const calendar = calendarFor(branch, party, 90, rules);

  /* Where the guest lands when they arrive, or when the day they asked for has
     nothing left. Sending them to today at 10pm — every sitting crossed out,
     "no time left to book for today" — is a dead end dressed as a page: the
     information is correct and the guest still has to work out what to do. */
  const asked = date;
  const askedDay = asked ? calendar.find((d) => d.date === asked) : undefined;
  const needsMove = !asked || (askedDay && askedDay.state !== "open");
  const suggestion = needsMove ? nextOpenDay(calendar, asked ?? undefined) ?? nextOpenDay(calendar) : undefined;
  const effectiveDate = asked && askedDay?.state === "open" ? asked : suggestion?.date ?? asked ?? null;

  /* Said on screen rather than left to be inferred, and phrased per reason:
     "we're shut on Mondays", "there's a wedding in" and "tonight's last
     sitting has gone" are three different problems for the guest, and only the
     last one means come back tomorrow. The manager's own words for a block are
     passed straight through — "Private event" tells someone to pick another
     date rather than ring, where a bare "unavailable" makes them ring. */
  const moved = (() => {
    if (!asked || !askedDay || askedDay.state === "open") return null;
    const to = suggestion ? ` Showing ${dateLabel(suggestion.date)} instead.` : "";
    const head =
      askedDay.state === "soon"
        ? "Tonight's last sitting has already gone."
        : askedDay.state === "closed"
          ? `${askedDay.reason}.`
          : `${dateLabel(asked)} isn't available: ${askedDay.reason}.`;
    if (!suggestion) {
      return `${head} We have nothing free in the next three months — please call us on ${branch.phone}.`;
    }
    return head + to;
  })();

  const step = chosenTime && guests && effectiveDate ? 3 : guests && effectiveDate ? 2 : 1;
  const availability = step >= 2 && guests && effectiveDate
    ? availabilityFor(branch, effectiveDate, guests, rules) : null;
  const deposit = guests && effectiveDate ? depositFor(rules, effectiveDate, guests) : 0;

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

          {/* The message used to be rendered here, above the calendar — which
              on a phone is roughly 1,600px above the box that was actually
              wrong, and the redirect carried no fragment, so the guest was
              returned to the top of the page to hunt for a form they had
              already filled in. It now sits inside the "Your details" panel,
              directly above the fields it is about. This is the fallback for
              the one case where that panel isn't rendered: the chosen time went
              while they were typing, so there is no step 3 to attach it to. */}
          {recalled && step < 3 && (
            <p role="alert" className="mt-8 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
              {recalled.message}
            </p>
          )}

          {/* ---------- step 1: party size and date ---------- */}
          <div className="mt-8 border border-[--line] bg-ink-2">
            <div className="px-5 sm:px-8 py-7">
              <h2 className="text-2xl sm:text-3xl">How many, and when?</h2>
              <form method="GET" action={here} className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label className={label} htmlFor="guests">Guests</label>
                  <select id="guests" name="guests" defaultValue={guests ?? 2} className={field}>
                    {partyOptions.map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-ink w-full sm:w-auto">
                  {step === 1 ? "Find a table" : "Update party size"}
                </button>
              </form>

              {moved && (
                <p role="status"
                  className="mt-5 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
                  {moved}
                </p>
              )}

              <div className="mt-6">
                <span className={label}>Date</span>
                <div className="max-w-sm">
                  <BookingCalendar
                    days={calendar}
                    selected={effectiveDate}
                    hrefPrefix={`${here}?guests=${party}&date=`}
                  />
                </div>
              </div>
              <p className="mt-4 text-xs text-pale/70">
                Booking for more than {rules.capacity.maxPartyOnline}?{" "}
                <a href={telHref(branch.phone)} className="underline hover:text-gold">
                  Call us on {branch.phone}
                </a>{" "}
                and we&rsquo;ll arrange it personally.
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
                            /* The fragment sends the guest to the form their click just
                               revealed. Without it they land at the top of a ~3,500px page
                               with "Your details" some 1,600px below — at every step, and
                               again after every validation error. */
                            href={`${here}?guests=${guests}&date=${availability.date}&time=${s.time}#your-details`}
                            aria-current={active ? "true" : undefined}
                            /* The chosen time was ink on ink with an ink border, against a
                               panel of the same ink — so choosing a slot REMOVED its outline
                               and sank it into the background while every slot they had not
                               chosen glowed. The affordance was inverted, in the one flow
                               that takes money. Gold fill now means chosen, as it does on
                               every other control on the site. */
                            className={`px-4 py-2.5 text-sm border transition-colors ${
                              active
                                ? "bg-gold text-ink border-gold font-semibold"
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
            {step === 3 && guests && effectiveDate && chosenTime && (
              <div className="border-t border-[--line] px-5 sm:px-8 py-7">
                <h2 id="your-details" className="text-2xl sm:text-3xl scroll-mt-28">Your details</h2>
                <p className="mt-1.5 text-sm text-pale/70">
                  {dateLabel(effectiveDate)} at {prettyTime(chosenTime)} · {guests} {guests === 1 ? "guest" : "guests"}
                </p>

                {/* Beside the fields it is about, not at the top of the page.
                    role="alert" so a screen reader announces it on arrival. */}
                {recalled && (
                  <p role="alert"
                    className="mt-6 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
                    {recalled.message}
                  </p>
                )}

                <form action={startBooking} className="mt-7 grid gap-6">
                  <input type="hidden" name="branch" value={branch.slug} />
                  <input type="hidden" name="date" value={effectiveDate} />
                  <input type="hidden" name="time" value={chosenTime} />
                  <input type="hidden" name="guests" value={guests} />

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label className={label} htmlFor="name">Name</label>
                      <input id="name" name="name" required autoComplete="name" className={field}
                        defaultValue={was("name")} autoFocus={focus === "name"}
                        aria-invalid={focus === "name" || undefined} />
                    </div>
                    <div>
                      <label className={label} htmlFor="phone">Phone</label>
                      <input id="phone" name="phone" type="tel" required autoComplete="tel" className={field}
                        defaultValue={was("phone")} autoFocus={focus === "phone"}
                        aria-invalid={focus === "phone" || undefined} />
                    </div>
                    <div>
                      <label className={label} htmlFor="email">Email</label>
                      <input id="email" name="email" type="email" required autoComplete="email" className={field}
                        defaultValue={was("email")} autoFocus={focus === "email"}
                        aria-invalid={focus === "email" || undefined} />
                      <span className="block text-xs text-pale/70 mt-1.5">Your confirmation goes here.</span>
                    </div>
                    <div>
                      <label className={label} htmlFor="occasion">Occasion</label>
                      <select id="occasion" name="occasion" className={field}
                        defaultValue={was("occasion") || rules.occasions.options[0]}>
                        {rules.occasions.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>

                  <fieldset>
                    <legend className={label}>Allergies in the party</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                      {rules.allergens.options.map((a) => (
                        <label key={a} className={`${choice} items-center`}>
                          <input type="checkbox" name="allergens" value={a}
                            defaultChecked={wasChecked("allergens", a)} /> {a}
                        </label>
                      ))}
                    </div>
                    <span className="block text-xs text-pale/70 mt-2.5">
                      Tick anything we should know about and the kitchen will be told.
                    </span>
                  </fieldset>

                  <div>
                    <label className={label} htmlFor="notes">Anything else?</label>
                    <textarea id="notes" maxLength={2000} name="notes" rows={3} className={field}
                      defaultValue={was("notes")}
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
                    <label className={choice}>
                      <input type="checkbox" name="terms" required />
                      <span className={choiceText}>{rules.consents.terms}</span>
                    </label>
                    {deposit > 0 && (
                      <>
                        <label className={choice}>
                          <input type="checkbox" name="depositTerms" required />
                          <span className={choiceText}>{rules.consents.deposit}</span>
                        </label>
                        <label className={choice}>
                          <input type="checkbox" name="depositRate" required />
                          <span className={choiceText}>{rules.consents.depositRate}</span>
                        </label>
                      </>
                    )}
                    <label className={choice}>
                      {/* Not carried back on an error, deliberately — see the
                          SKIP list in form-recall. Every other answer returns,
                          but a marketing consent that reappears already ticked
                          without the guest touching it is a pre-ticked box, and
                          consent has to be a thing they did. */}
                      <input type="checkbox" name="marketing" />
                      <span className={choiceText}>{rules.consents.marketing}</span>
                    </label>
                  </fieldset>

                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <SubmitButton pendingLabel="Taking you to payment…">
                      {deposit > 0 ? `Pay ${formatPence(deposit)} and confirm` : "Confirm booking"}
                    </SubmitButton>
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
              move your booking with 24 hours&rsquo; notice.
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
