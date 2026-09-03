import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug } from "@/lib/branches";
import { brand } from "@/lib/brand";
import { formatPence } from "@/lib/money";
import {
  voucherByCode, activatePaidVoucher, markPurchaseFailed, expiryLabel,
} from "@/lib/voucher";
import { retrieveSession, stripeSimulated } from "@/lib/stripe";
import { PageHero } from "@/components/PageHero";

export const metadata: Metadata = { title: "Gift voucher purchased", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Where Stripe returns the buyer. Fulfils here as well as in the webhook. */
export default async function VoucherConfirmed({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ code?: string; session_id?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  const { code, session_id: sessionId } = await searchParams;
  const found = code ? voucherByCode(code) : undefined;
  if (!found) notFound();

  let paid = found.status === "active" || found.status === "redeemed";
  let problem: string | null = null;

  if (!paid && sessionId) {
    if (stripeSimulated() && sessionId.startsWith("sim_")) {
      await activatePaidVoucher({ voucherId: found.id, sessionId });
      paid = true;
    } else {
      try {
        const session = await retrieveSession(sessionId);
        if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
          await activatePaidVoucher({
            voucherId: found.id,
            paymentIntent: session.payment_intent,
            sessionId: session.id,
          });
          paid = true;
        } else if (session.status === "expired") {
          markPurchaseFailed(found.id);
          problem = "The payment page expired before the payment completed, so no voucher was issued.";
        } else {
          problem = "Your payment is still being processed. We'll email the voucher the moment it clears.";
        }
      } catch (err) {
        console.error("[voucher] could not verify the payment session:", err);
        problem = "We couldn't verify your payment just now. If you were charged, the voucher will follow shortly.";
      }
    }
  }

  const v = voucherByCode(found.code)!;

  if (!paid) {
    return (
      <>
        <PageHero image={brand.giftVoucherImage} kicker="Gift vouchers"
          heading="This voucher isn't issued yet" />
        <section className="bg-ink">
          <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
            <p className="border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
              {problem ?? "We haven't received your payment, so no voucher has been issued."}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${branch.slug}/gift-vouchers`} className="btn btn-ink">Try again</Link>
            </div>
          </div>
        </section>
      </>
    );
  }

  const scheduled = v.deliverOn && !v.deliveredAt;

  return (
    <>
      <PageHero
        image={brand.giftVoucherImage}
        kicker="Gift vouchers"
        heading="Your gift voucher is ready"
        intro={scheduled
          ? `We'll send it to ${v.recipientName} on ${new Date(`${v.deliverOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`
          : `We've emailed it to ${v.recipientName} at ${v.recipientEmail}.`}
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
          <div className="border border-[--line] bg-ink-2">
            <div className="px-6 sm:px-8 py-7 border-b border-[--line] flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-2xl">Gift voucher</h2>
              <span className="display text-3xl text-gold tnum">{formatPence(v.valuePence)}</span>
            </div>
            <dl className="px-6 sm:px-8 py-7 grid gap-x-8 gap-y-4 sm:grid-cols-2 text-sm">
              {[
                ["Code", v.code],
                ["For", `${v.recipientName} (${v.recipientEmail})`],
                ["From", v.purchaserName ?? ""],
                ["Valid until", expiryLabel(v)],
                ["Valid at", v.branchId ? `Varanasi ${branch.city}` : "Birmingham or Leicester"],
                ...(v.message ? [["Your message", `"${v.message}"`]] : []),
              ].map(([k, val]) => (
                <div key={k}>
                  <dt className="accent text-[0.58rem] text-gold">{k}</dt>
                  <dd className="mt-1 break-words">{val}</dd>
                </div>
              ))}
            </dl>
            <div className="px-6 sm:px-8 py-6 border-t border-[--line] text-sm text-pale/70">
              A receipt is on its way to {v.purchaserEmail}. Keep the code safe — it&rsquo;s all they need.
            </div>
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={`/${branch.slug}/menu`} className="btn btn-ink">See the menu</Link>
            <Link href={`/${branch.slug}/gift-vouchers`} className="btn btn-outline">Buy another</Link>
          </div>
        </div>
      </section>
    </>
  );
}
