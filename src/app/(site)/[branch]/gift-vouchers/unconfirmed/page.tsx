import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { brand } from "@/lib/brand";
import { PageHero } from "@/components/PageHero";

export const metadata: Metadata = { title: "Payment not completed", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Backed out of the payment page — say plainly that nothing was bought. */
export default async function VoucherUnconfirmed({
  params,
}: {
  params: Promise<{ branch: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  /* This page reads nothing and writes nothing, and both of those are
   * deliberate.
   *
   * It used to cancel the purchase: `if (v.status === "pending")
   * markPurchaseFailed(v.id)` — a state change on a plain GET, keyed on
   * nothing but a code that travels in a URL. Anything that follows a link
   * without a human deciding to (the browser's own prefetch, a link preview in
   * a chat app, a corporate mail scanner) cancelled a live purchase. Then the
   * buyer went back and paid, and got a voucher worth nothing.
   *
   * Nothing needs to happen here. Stripe tells us when a checkout is really
   * abandoned — `checkout.session.expired` on the signed webhook — and the
   * return page asks Stripe directly. Both of those are answers from the
   * payment provider. A guest pressing "back" is not an answer; it is a guest
   * who may still pay in thirty seconds.
   */

  return (
    <>
      <PageHero
        image={brand.giftVoucherImage}
        kicker="Gift vouchers"
        heading="Your payment wasn't completed"
        intro="No voucher has been issued, and nothing has been charged."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[46rem] px-5 lg:px-10 py-14 sm:py-20">
          <p className="border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
            Nobody has been emailed and no code has been created. You&rsquo;re welcome to start again.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href={`/${branch.slug}/gift-vouchers`} className="btn btn-gold">Try again</Link>
            <a href={telHref(branch.phone)} className="btn btn-outline">Call {branch.phone}</a>
          </div>
          <p className="mt-8 text-sm text-pale/70">
            If you think you were charged, please call us with the time you tried and we&rsquo;ll check straight away.
          </p>
        </div>
      </section>
    </>
  );
}
