import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { prettyTime } from "@/lib/booking-config";
import { formatPence } from "@/lib/money";
import { bookingByReference, dateLabel } from "@/lib/booking";
import { PageHero } from "@/components/PageHero";
import { cancelBooking } from "./actions";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The link in the confirmation email. The reference alone isn't enough to open
 * it — the emailed token has to match too, so a guessed reference shows nothing.
 */
export default async function ManageBooking({
  params, searchParams,
}: {
  params: Promise<{ branch: string; reference: string }>;
  searchParams: Promise<{ t?: string; cancelled?: string; error?: string; cancel?: string }>;
}) {
  const { branch: slug, reference } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  const { t: token, cancelled, error, cancel } = await searchParams;
  const confirming = cancel === "1";
  const booking = bookingByReference(reference);
  if (!booking || booking.branchId !== branch.id) notFound();
  if (!token || !booking.cancelToken || token !== booking.cancelToken) notFound();

  const isCancelled = booking.status === "cancelled" || cancelled === "1";
  const depositPaid = Boolean(booking.depositPence) && booking.depositStatus === "captured";
  const isPast = booking.date < new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHero
        image={branch.heroImage}
        kicker="Your booking"
        heading={isCancelled ? "This booking is cancelled" : `Table for ${booking.partySize} at Varanasi ${branch.city}`}
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
          {error && (
            <p role="alert" className="mb-6 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">{error}</p>
          )}
          {cancelled === "1" && (
            <p role="status" className="mb-6 border-l-2 border-leaf bg-leaf/10 px-4 py-3 text-sm">
              Your booking has been cancelled and the restaurant has been told.
            </p>
          )}

          <div className={`border border-[--line] bg-ink-2 ${isCancelled ? "opacity-60" : ""}`}>
            <div className="px-6 sm:px-8 py-7 border-b border-[--line] flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-2xl">Varanasi {branch.city}</h2>
              <span className="accent text-[0.65rem] text-gold tnum">{booking.reference}</span>
            </div>
            <dl className="px-6 sm:px-8 py-7 grid gap-x-8 gap-y-4 sm:grid-cols-2 text-sm">
              {[
                ["Date", dateLabel(booking.date)],
                ["Time", prettyTime(booking.time)],
                ["Guests", String(booking.partySize)],
                ["Status", isCancelled ? "Cancelled" : booking.status === "held" ? "Awaiting payment" : "Confirmed"],
                ...(booking.occasion && booking.occasion !== "No special occasion"
                  ? [["Occasion", booking.occasion]] : []),
                ...(booking.depositPence && booking.depositStatus === "captured"
                  ? [["Deposit paid", formatPence(booking.depositPence)]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="accent text-[0.58rem] text-gold">{k}</dt>
                  <dd className="mt-1">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {!isCancelled && !isPast && (
            <div className="mt-9">
              <h3 className="text-xl">Need to change something?</h3>
              <p className="mt-2 text-sm text-pale/70 max-w-[52ch]">
                To move your booking, please call us on{" "}
                <a href={telHref(branch.phone)} className="underline hover:text-gold">{branch.phone}</a>{" "}
                with at least 24 hours' notice and we'll find you another time — your deposit moves with it.
              </p>
              {/* Two steps, because one tap used to do it. Cancelling forfeits a
                  paid deposit and there is no undo, so an accidental touch on a
                  phone cost the guest their money and the restaurant a cover —
                  and the page afterwards said "Cancelled" beside "Deposit paid
                  £20" without ever mentioning the £20 was gone. */}
              {confirming ? (
                <div className="mt-6 border border-brick/40 bg-clay/10 px-5 py-4">
                  <p className="font-semibold text-brick">
                    Cancel this booking{depositPaid ? ` and forfeit the ${formatPence(booking.depositPence)} deposit` : ""}?
                  </p>
                  <p className="text-sm text-pale/70 mt-2 max-w-[52ch]">
                    {depositPaid
                      ? `Your ${formatPence(booking.depositPence)} deposit is non-refundable and will not be returned. `
                      : ""}
                    This cannot be undone. If you only need a different date, call us on{" "}
                    <a href={telHref(branch.phone)} className="underline hover:text-gold">{branch.phone}</a>{" "}
                    instead and your deposit moves with the booking.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <form action={cancelBooking}>
                      <input type="hidden" name="branch" value={branch.slug} />
                      <input type="hidden" name="reference" value={booking.reference} />
                      <input type="hidden" name="token" value={token} />
                      <button className="text-sm text-pale bg-brick px-4 py-2.5 font-semibold">
                        Yes, cancel it
                      </button>
                    </form>
                    <a href={`?t=${token}`}
                      className="text-sm border border-[--line] px-4 py-2.5 hover:border-gold hover:text-gold">
                      Keep my booking
                    </a>
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <a href={`?t=${token}&cancel=1`}
                    className="inline-block text-sm text-brick border border-brick/40 px-4 py-2.5 hover:bg-clay/10">
                    Cancel this booking
                  </a>
                  <span className="block text-xs text-pale/70 mt-2.5">
                    Deposits are non-refundable, so please call us instead if you only need to change the date.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={`/${branch.slug}/menu`} className="btn btn-ink">See the menu</Link>
            {isCancelled && (
              <Link href={`/${branch.slug}/book-online`} className="btn btn-gold">Book again</Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
