import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { formatPence } from "@/lib/money";
import { voucherByCode, expiryLabel, expireOldVouchers } from "@/lib/voucher";
import { qrSvg } from "@/lib/qr";

export const metadata: Metadata = { title: "Your gift voucher", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The voucher itself: something to print, or to show on a phone at the table.
 *
 * Until now a gift voucher was a code in an email, which is fine for the
 * person who bought it and thin as a present. It is also awkward at the till:
 * a member of staff has to read a twelve-character code off a guest's screen
 * and type it into the admin, at the end of an evening, in low light.
 *
 * So this page is both halves of that. It looks like a voucher, and it carries
 * a QR code that opens the redeem screen with the code already filled in — so
 * staff can scan it or type it, and neither is the only way.
 *
 * The code is the credential, which is the right model for a gift: whoever
 * holds it can spend it, exactly like a paper voucher, and it is twelve
 * characters from a 32-letter alphabet — sixty bits, which is not guessable.
 * For that reason the page shows what is printed on a voucher and no more: the
 * names on it and the message, never either party's email address, and the
 * page is marked `noindex` so it never turns up in a search result.
 */
export default async function VoucherPage({
  params,
}: {
  params: Promise<{ branch: string; code: string }>;
}) {
  const { branch: slug, code } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();

  // Anything past its date stops being spendable the moment it is looked at.
  expireOldVouchers();
  const v = voucherByCode(code);
  if (!v || v.status === "pending") notFound();

  /* Where the QR points: the till's own redeem screen, with the code in the
     query string. A member of staff scanning this is already signed in, so it
     opens ready to take an amount off; anybody else who scans it gets a
     sign-in page, which is the correct answer to a stranger with a camera. */
  const site = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redeemUrl = `${site}/admin/vouchers?code=${encodeURIComponent(v.code)}`;
  const qr = qrSvg(redeemUrl, { size: 168, label: `Gift voucher ${v.code}` });

  const spent = v.valuePence - v.balancePence;
  const dead = v.status === "cancelled" || v.status === "expired" || v.balancePence <= 0;

  return (
    <main className="bg-pale text-ink min-h-dvh py-10 px-5 print:py-0">
      {/* One card, sized so it prints on a single sheet without a dialogue
          full of choices. `print:` rules drop the page furniture. */}
      <div className="mx-auto max-w-[40rem]">
        <article className="border border-ink/15 bg-white shadow-sm print:border-ink/30 print:shadow-none">
          <header className="bg-ink text-pale px-8 py-7 text-center">
            <p className="accent text-[0.6rem] text-gold">Gift voucher</p>
            <h1 className="display mt-2 text-3xl tracking-wide">VARANASI</h1>
            <p className="mt-1 text-[0.7rem] text-pale/70">{branch.city}</p>
          </header>

          <div className="px-8 py-8 text-center">
            {v.recipientName && (
              <p className="text-sm text-ink-3">
                For <strong className="text-ink">{v.recipientName}</strong>
                {v.purchaserName ? <>, from <strong className="text-ink">{v.purchaserName}</strong></> : null}
              </p>
            )}

            <p className="display mt-4 text-5xl tnum">{formatPence(v.balancePence)}</p>
            {spent > 0 && v.balancePence > 0 && (
              <p className="mt-1 text-xs text-ink-3">
                remaining of {formatPence(v.valuePence)}
              </p>
            )}

            {dead && (
              <p role="status" className="mt-5 border-l-2 border-brick bg-clay/10 px-4 py-2.5 text-sm text-brick">
                {v.status === "cancelled" ? "This voucher has been cancelled."
                  : v.status === "expired" ? `This voucher expired on ${expiryLabel(v)}.`
                  : "This voucher has been used in full."}
              </p>
            )}

            {v.message && (
              <blockquote className="mt-6 border-l-2 border-gold/60 bg-pale/60 px-4 py-3 text-left text-sm italic">
                &ldquo;{v.message}&rdquo;
              </blockquote>
            )}

            <div className="mt-7 flex flex-col items-center gap-3">
              <div dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="tnum text-lg font-semibold tracking-[0.12em]">{v.code}</p>
              <p className="text-xs text-ink-3 max-w-[34ch] leading-relaxed">
                Show this to us and we&rsquo;ll take it off your bill. You don&rsquo;t have to spend
                it all at once.
              </p>
            </div>

            <dl className="mt-8 grid gap-4 border-t border-[--line] pt-6 text-left text-sm sm:grid-cols-2">
              <div>
                <dt className="accent text-[0.55rem] text-gold-ink">Valid at</dt>
                <dd className="mt-0.5">
                  {v.branchId ? `Varanasi ${branch.city}` : "Birmingham or Leicester"}
                </dd>
              </div>
              <div>
                <dt className="accent text-[0.55rem] text-gold-ink">Valid until</dt>
                <dd className="mt-0.5">{expiryLabel(v)}</dd>
              </div>
            </dl>
          </div>

          <footer className="border-t border-[--line] px-8 py-5 text-center text-xs text-ink-3">
            {branch.addressLine}, {branch.city}, {branch.postcode} ·{" "}
            <a href={telHref(branch.phone)} className="underline">{branch.phone}</a>
          </footer>
        </article>

        {/* Off the printed sheet. */}
        <div className="mt-6 flex flex-wrap justify-center gap-3 print:hidden">
          <Link href={`/${branch.slug}/book-online`} className="btn btn-ink">Book a table</Link>
          <Link href={`/${branch.slug}/menu`} className="btn btn-outline">See the menu</Link>
        </div>
        <p className="mt-4 text-center text-xs text-ink-3 print:hidden">
          Print this page, or keep it on your phone — either works.
        </p>
      </div>
    </main>
  );
}
