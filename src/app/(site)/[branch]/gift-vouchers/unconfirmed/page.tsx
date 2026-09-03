import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { brand } from "@/lib/brand";
import { voucherByCode, markPurchaseFailed } from "@/lib/voucher";
import { PageHero } from "@/components/PageHero";

export const metadata: Metadata = { title: "Payment not completed", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Backed out of the payment page — say plainly that nothing was bought. */
export default async function VoucherUnconfirmed({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  const { code } = await searchParams;
  const v = code ? voucherByCode(code) : undefined;
  if (v && v.status === "pending") markPurchaseFailed(v.id);

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
