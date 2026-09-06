import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { prettyTime } from "@/lib/booking-config";
import { formatPence } from "@/lib/money";
import {
  bookingByReference, confirmPaidBooking, dateLabel, markPaymentFailed, notifyPaymentFailed,
  notifyVerificationFailed,
} from "@/lib/booking";
import { retrieveSession, stripeSimulated } from "@/lib/stripe";
import { databaseDiagnostics } from "@/db";
import { PageHero } from "@/components/PageHero";

export const metadata: Metadata = { title: "Booking confirmed", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Where Stripe sends the guest after payment.
 *
 * Stripe's guidance is that the webhook is the authority — a guest can pay and
 * lose their connection before this page loads — but that you should ALSO
 * fulfil here, because webhooks can lag and the guest is standing right in
 * front of you wanting an answer. `confirmPaidBooking` is idempotent, so
 * whichever arrives first wins and the second does nothing.
 */
export default async function Confirmed({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ ref?: string; session_id?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  const { ref, session_id: sessionId } = await searchParams;
  const booking = ref ? bookingByReference(ref) : undefined;

  /* A reference that reached Stripe but cannot be found here is not a guest
     error, and 404 is the wrong thing to say about it: the row is written
     before the payment page is created, so the reference existing at all means
     it was written *somewhere*. When the two disagree the usual cause is two
     servers on two databases — `DATABASE_URL` is a relative path, resolved
     against whatever folder the server was started in. So say which file was
     searched, in development, rather than sending a developer round the houses
     for it. The guest-facing 404 is unchanged in production. */
  if (!booking || booking.branchId !== branch.id) {
    if (process.env.NODE_ENV !== "production") {
      const where = databaseDiagnostics();
      console.error(
        `[booking] ${ref ?? "(no reference)"} is not in the database this server has open.\n`
        + `          file: ${where.resolved}\n`
        + `          holds: ${Object.entries(where.counts).map(([t, n]) => `${n} ${t}`).join(", ")}\n`
        + `          If the booking reached Stripe, it was written somewhere else — check which\n`
        + `          folder 'npm run dev' was started from, and see Settings → Storage.`,
      );
    }
    notFound();
  }

  let paid = booking.depositStatus === "captured" || booking.depositStatus === "none";
  let problem: string | null = null;
  /** The real reason, kept for the development-only panel below. */
  let detail: string | null = null;

  if (!paid && sessionId) {
    if (stripeSimulated() && sessionId.startsWith("sim_")) {
      // the built-in simulator has already decided this was a success
      await confirmPaidBooking({ bookingId: booking.id, sessionId });
      paid = true;
    } else {
      try {
        const session = await retrieveSession(sessionId);
        if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
          await confirmPaidBooking({
            bookingId: booking.id,
            paymentIntent: session.payment_intent,
            sessionId: session.id,
          });
          paid = true;
        } else if (session.status === "expired") {
          detail = `Stripe says the checkout session expired (status=${session.status}).`;
          markPaymentFailed(booking.id);
          await notifyPaymentFailed(booking);
          problem = "Your payment page expired before the payment completed, so the table wasn't held.";
        } else {
          // still processing (a delayed payment method) — the webhook will finish it
          problem = "Your payment is still being processed. We'll email you the moment it clears — you don't need to do anything.";
          detail = `Stripe says payment_status=${session.payment_status}, status=${session.status}. `
            + "That is a payment method that settles later (Bacs, Klarna and similar), or a "
            + "checkout that was not completed. The webhook confirms it when the money lands.";
        }
      } catch (err) {
        /* The guest has just come back from Stripe's own payment page, so the
         * likeliest reading of an error here is that they HAVE been charged
         * and we cannot see it. Three things follow from that, none of which
         * used to happen:
         *
         *  - the restaurant is told, because otherwise nobody finds out until
         *    the guest arrives at a table that was never booked;
         *  - the reason is logged in full, since "could not verify" on its own
         *    is not something anyone can act on at 10pm on a Saturday;
         *  - the guest is not told to "try again", which on a card that has
         *    already been charged is the worst advice available.
         */
        detail = err instanceof Error ? err.message : String(err);
        console.error(
          `[booking] ${booking.reference}: could not verify Stripe session ${sessionId} — ${detail}`,
        );
        /* Awaited, not fired and forgotten. `void` here left a floating promise
           in a server component: the response finishes, the render is done, and
           whether the restaurant is ever told depends on whether the runtime
           happens to keep the process alive long enough. On the one path where
           a guest may have been charged for a table nobody knows about, "we
           probably told them" is not good enough — and the wait is one HTTP
           call on a page that has already made one. */
        await notifyVerificationFailed(booking, sessionId, detail);
        problem = "verify";
      }
    }
  }

  /* The Stripe session id has done its job, so take it out of the address bar.
   *
   * It is there to prove the payment: a redirect on its own proves nothing, so
   * the page carries the id back to Stripe and asks whether the money actually
   * arrived. Once that has been answered and the booking is confirmed, the id
   * is spent — and leaving it in the URL has three small costs. It is what the
   * guest bookmarks, screenshots and forwards to the six people they are
   * organising, so a Stripe object id travels with it. Every refresh of that
   * page makes another API call to Stripe to re-answer a settled question. And
   * the address the guest keeps is forty characters of noise around the only
   * part that means anything, which is their reference.
   *
   * Only when it is confirmed. An unverified payment keeps the id, because
   * that page's whole purpose is that a refresh can try the question again.
   */
  if (paid && sessionId) {
    redirect(`/${branch.slug}/book-online/confirmed?ref=${encodeURIComponent(booking.reference)}`);
  }

  const current = bookingByReference(booking.reference)!;
  const manageHref = `/${branch.slug}/booking/${current.reference}?t=${current.cancelToken}`;

  /* ---------- payment didn't land ---------- */
  if (!paid) {
    /* "We couldn't check" and "you weren't charged" are opposite situations
       for the guest and used to share a page. Someone whose card has been
       debited must not be shown a "Try again" button. */
    const unverified = problem === "verify";
    return (
      <>
        <PageHero image={branch.heroImage} kicker="Reservations"
          heading={unverified ? "We're checking your payment" : "Your booking isn't confirmed yet"} />
        <section className="bg-ink">
          <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
            <p role="alert" className="border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
              {unverified
                ? "Your payment went to Stripe, but we couldn't read the result just now. If you were charged, the table is yours — we've alerted the restaurant and your confirmation will follow."
                : problem ?? "We haven't received your deposit, so no table is being held."}
            </p>

            {/* The guest is told something kind and useless; whoever is building
                the site needs the actual reason, and hunting it out of a
                terminal has cost several rounds of guessing. Development only —
                a guest must never see a Stripe error message. */}
            {process.env.NODE_ENV !== "production" && detail && (
              <pre className="mt-4 overflow-x-auto border border-brick/40 bg-brick/10 px-4 py-3 text-xs whitespace-pre-wrap">
                <strong>Development only.</strong> {detail}
              </pre>
            )}

            {/* Something to quote down the telephone. Without it a guest ringing
                about a payment has nothing to identify it by. */}
            <dl className="mt-7 border border-[--line] bg-ink-2 px-5 py-4 text-sm grid gap-2 sm:grid-cols-2">
              <div><dt className="text-pale/50">Reference</dt>
                <dd className="tnum font-semibold">{current.reference}</dd></div>
              <div><dt className="text-pale/50">Table requested</dt>
                <dd>{dateLabel(current.date)} at {prettyTime(current.time)}, {current.partySize}{" "}
                  {current.partySize === 1 ? "guest" : "guests"}</dd></div>
            </dl>

            <p className="mt-6 text-pale/70">
              {unverified
                ? "Please don't pay again. Ring us with the reference above and we'll confirm it in a moment."
                : "Nothing further is needed from you if your payment is still processing. Otherwise, you're welcome to try again, or call us and we'll book you in ourselves."}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={telHref(branch.phone)} className="btn btn-gold">Call {branch.phone}</a>
              {!unverified && (
                <Link href={`/${branch.slug}/book-online`} className="btn btn-outline">Try again</Link>
              )}
            </div>
          </div>
        </section>
      </>
    );
  }

  /* ---------- confirmed ---------- */
  return (
    <>
      <PageHero
        image={branch.heroImage}
        kicker="Reservations"
        heading="Your table is confirmed"
        intro={`We've emailed your confirmation to ${current.email}.`}
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
          <div className="border border-[--line] bg-ink-2">
            <div className="px-6 sm:px-8 py-7 border-b border-[--line] flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-2xl">Varanasi {branch.city}</h2>
              <span className="accent text-[0.65rem] text-gold tnum">{current.reference}</span>
            </div>
            <dl className="px-6 sm:px-8 py-7 grid gap-x-8 gap-y-4 sm:grid-cols-2 text-sm">
              {[
                ["Date", dateLabel(current.date)],
                ["Time", prettyTime(current.time)],
                ["Guests", String(current.partySize)],
                ["Name", current.guestName],
                ...(current.occasion && current.occasion !== "No special occasion"
                  ? [["Occasion", current.occasion]] : []),
                ...(current.dietary ? [["Allergies noted", current.dietary.split(",").join(", ")]] : []),
                ...(current.depositPence
                  ? [["Deposit paid", `${formatPence(current.depositPence)} — deducted from your bill`]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="accent text-[0.58rem] text-gold">{k}</dt>
                  <dd className="mt-1">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="px-6 sm:px-8 py-6 border-t border-[--line] bg-ink-2/[0.02] text-sm text-pale/70">
              <p>
                {branch.addressLine}, {branch.city}, {branch.postcode} ·{" "}
                <a href={telHref(branch.phone)} className="underline hover:text-gold">{branch.phone}</a>
              </p>
              <p className="mt-2">
                Need to change or cancel? Please give us at least 24 hours&rsquo; notice —{" "}
                <Link href={manageHref} className="underline hover:text-gold">manage your booking</Link>.
              </p>
            </div>
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={`/${branch.slug}/menu`} className="btn btn-ink">See the menu</Link>
            <Link href={`/${branch.slug}/drinks`} className="btn btn-outline">
              Drinks &amp; cocktails
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
