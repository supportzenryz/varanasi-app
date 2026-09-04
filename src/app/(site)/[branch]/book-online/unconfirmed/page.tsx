import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { prettyTime } from "@/lib/booking-config";
import { bookingByReference, dateLabel, markPaymentFailed, notifyPaymentFailed } from "@/lib/booking";
import { PageHero } from "@/components/PageHero";

export const metadata: Metadata = { title: "Payment not completed", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Where Stripe sends a guest who backs out of the payment page.
 *
 * The client's requirement, said plainly: if the payment didn't succeed, tell
 * them the booking is NOT confirmed. The held table is released here rather
 * than left to time out, so the slot goes straight back on sale.
 */
export default async function Unconfirmed({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ ref?: string; t?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  const { ref, t: token } = await searchParams;
  const booking = ref ? bookingByReference(ref) : undefined;

  /* Releasing the table needs the booking's own token, not just its reference.
   * This page acts on a plain GET, so with only `?ref=` anyone holding the
   * reference — or any link preview, email scanner or prefetch that touched
   * the URL — released the hold and triggered a payment-failed notice. Stripe's
   * cancel_url now carries the token, so the real journey still works and a
   * guessed or scraped reference does nothing.
   *
   * And only if it really is unpaid: a guest can reach this page by pressing
   * Back after paying, and a paid booking must never be cancelled here. */
  const authorised = Boolean(booking?.cancelToken) && token === booking?.cancelToken;
  if (authorised && booking && booking.branchId === branch.id && booking.depositStatus !== "captured") {
    markPaymentFailed(booking.id);
    await notifyPaymentFailed(booking);
  }

  const retry = booking
    ? `/${branch.slug}/book-online?guests=${booking.partySize}&date=${booking.date}&time=${booking.time}`
    : `/${branch.slug}/book-online`;

  return (
    <>
      <PageHero
        image={branch.heroImage}
        kicker="Reservations"
        heading="Your payment wasn't completed"
        intro="Your booking has not been confirmed, and no table is being held."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
          <p className="border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
            Nothing has been charged. The deposit confirms the table, so until it's paid the time stays
            available to other guests.
          </p>

          {booking && (
            <div className="mt-8 border border-[--line] bg-ink-2 px-6 py-6">
              <span className="accent text-[0.6rem] text-gold">What you asked for</span>
              <p className="mt-2 text-sm">
                {dateLabel(booking.date)} at {prettyTime(booking.time)} ·{" "}
                {booking.partySize} {booking.partySize === 1 ? "guest" : "guests"} · Varanasi {branch.city}
              </p>
              <p className="mt-2 text-xs text-pale/70">
                That time may still be free — try again and it takes under a minute.
              </p>
            </div>
          )}

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={retry} className="btn btn-gold">Try the payment again</Link>
            <a href={telHref(branch.phone)} className="btn btn-outline">
              Book by phone — {branch.phone}
            </a>
          </div>

          <p className="mt-8 text-sm text-pale/70">
            If you think you were charged, please{" "}
            {branch.bookingEmail
              ? <a href={`mailto:${branch.bookingEmail}`} className="underline hover:text-gold">email us</a>
              : "call us"}{" "}
            with the time you tried and we'll check straight away.
          </p>
        </div>
      </section>
    </>
  );
}
