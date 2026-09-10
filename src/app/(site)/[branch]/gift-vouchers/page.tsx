import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allBranches, branchBySlug } from "@/lib/branches";
import { brand } from "@/lib/brand";
import { voucherRules } from "@/lib/booking-config";
import { formatPence } from "@/lib/money";
import { PageHero } from "@/components/PageHero";
import { recallSubmission } from "@/lib/form-recall";
import { buyVoucher } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { choice, choiceText, field, label } from "@/lib/forms";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Gift Vouchers",
    description: `Give the gift of Varanasi. Gift vouchers for our ${b.city} restaurant, delivered by email with your own message.`,
    alternates: { canonical: `/${b.slug}/gift-vouchers` },
  };
}


function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function GiftVouchers({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ error?: string; value?: string; focus?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const { error, value: preselected, focus: focusParam } = await searchParams;

  /* What the buyer typed last time, when the last time was a rejection. The
     message they wrote for the recipient is the expensive thing to lose. */
  const recalled = error ? await recallSubmission(`/${branch.slug}/gift-vouchers`) : null;
  const was = (name: string) => recalled?.values[name] ?? "";
  const focus = recalled ? focusParam : undefined;

  const rules = voucherRules();
  const branches = allBranches();

  return (
    <>
      <PageHero
        image={brand.giftVoucherImage}
        kicker="Gift vouchers"
        heading="Give the gift of Varanasi"
        intro="Choose an amount, add your own message, and we'll email it to them — instantly, or on the morning of the day that matters."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[58rem] px-5 lg:px-10 py-14 sm:py-20">
          {recalled && (
            <p role="alert" className="mb-8 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
              {recalled.message}
            </p>
          )}

          <form id="buy" action={buyVoucher} className="grid gap-10 scroll-mt-28">
            <input type="hidden" name="branch" value={branch.slug} />

            {/* amount */}
            <fieldset>
              <legend className="text-2xl sm:text-3xl">How much?</legend>
              <div className="mt-6 flex flex-wrap gap-2.5">
                {rules.valuesPence.map((p, i) => (
                  <label key={p} className="cursor-pointer">
                    <input type="radio" name="value" value={p} className="peer sr-only"
                      defaultChecked={preselected ? Number(preselected) === p : i === 1} />
                    <span className="block px-6 py-3.5 border border-[--line] text-lg tnum
                                     peer-checked:bg-gold peer-checked:text-ink peer-checked:border-gold
                                     peer-focus-visible:outline peer-focus-visible:outline-2
                                     peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold
                                     hover:border-gold transition-colors">
                      {formatPence(p)}
                    </span>
                  </label>
                ))}
                {rules.allowCustom && (
                  <label className="cursor-pointer">
                    <input type="radio" name="value" value="custom" className="peer sr-only" />
                    <span className="block px-6 py-3.5 border border-[--line] text-lg
                                     peer-checked:bg-gold peer-checked:text-ink peer-checked:border-gold
                                     peer-focus-visible:outline peer-focus-visible:outline-2
                                     peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold
                                     hover:border-gold transition-colors">
                      Another amount
                    </span>
                  </label>
                )}
              </div>
              {rules.allowCustom && (
                <div className="mt-4 max-w-[16rem]">
                  <label className={label} htmlFor="customValue">
                    Your own amount (£{(rules.minPence / 100).toFixed(0)}–£{(rules.maxPence / 100).toFixed(0)})
                  </label>
                  <input id="customValue" name="customValue" inputMode="decimal"
                    defaultValue={was("customValue")} autoFocus={focus === "customValue"}
                    placeholder="e.g. 120" className={field} />
                  <span className="block text-xs text-pale/45 mt-1.5">
                    Typing here chooses &ldquo;Another amount&rdquo; for you.
                  </span>
                </div>
              )}
            </fieldset>

            {/* where it can be spent */}
            {rules.allowBranchChoice && (
              <fieldset>
                <legend className="text-2xl sm:text-3xl">Where can they use it?</legend>
                <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
                  <label className="cursor-pointer">
                    <input type="radio" name="validAt" value="" className="peer sr-only" defaultChecked />
                    <span className="block px-5 py-4 border border-[--line] text-sm
                                     peer-checked:border-gold peer-checked:text-gold hover:border-gold transition-colors">
                      Either restaurant
                      <span className="block text-xs text-pale/45 mt-1 peer-checked:text-pale/70">
                        Birmingham or Leicester
                      </span>
                    </span>
                  </label>
                  {branches.map((b) => (
                    <label key={b.id} className="cursor-pointer">
                      <input type="radio" name="validAt" value={b.slug} className="peer sr-only"
                        defaultChecked={b.slug === branch.slug && false} />
                      <span className="block px-5 py-4 border border-[--line] text-sm
                                       peer-checked:border-gold peer-checked:text-gold hover:border-gold transition-colors">
                        Varanasi {b.city}
                        <span className="block text-xs text-pale/45 mt-1">{b.addressLine}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* who */}
            <fieldset>
              <legend className="text-2xl sm:text-3xl">Who is it for?</legend>
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="toName">Their name</label>
                  <input id="toName" name="toName" required className={field} defaultValue={was("toName")} />
                </div>
                <div>
                  <label className={label} htmlFor="toEmail">Their email</label>
                  <input id="toEmail" name="toEmail" type="email" required className={field}
                    defaultValue={was("toEmail")} autoFocus={focus === "toEmail"} />
                  <span className="block text-xs text-pale/45 mt-1.5">The voucher goes straight here.</span>
                </div>
                <div>
                  <label className={label} htmlFor="fromName">Your name</label>
                  <input id="fromName" name="fromName" required autoComplete="name" className={field}
                    defaultValue={was("fromName")} />
                </div>
                <div>
                  <label className={label} htmlFor="fromEmail">Your email</label>
                  <input id="fromEmail" name="fromEmail" type="email" required autoComplete="email" className={field}
                    defaultValue={was("fromEmail")} autoFocus={focus === "fromEmail"} />
                  <span className="block text-xs text-pale/45 mt-1.5">Your receipt comes here.</span>
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="message">Your message</label>
                  <textarea id="message" name="message" rows={3} maxLength={500} className={field}
                    defaultValue={was("message")}
                    placeholder="Happy birthday — dinner is on us. Enjoy every course." />
                  <span className="block text-xs text-pale/45 mt-1.5">
                    Printed on the voucher exactly as you write it. Up to 500 characters.
                  </span>
                </div>
                <div>
                  <label className={label} htmlFor="deliverOn">When should we send it?</label>
                  <input id="deliverOn" name="deliverOn" type="date" min={todayISO()} className={field}
                    defaultValue={was("deliverOn")} />
                  <span className="block text-xs text-pale/45 mt-1.5">
                    Leave blank to send it as soon as you&rsquo;ve paid.
                  </span>
                </div>
              </div>
            </fieldset>

            {/* terms + pay */}
            <div className="border border-gold/40 bg-gold/8 px-5 py-5">
              <span className="accent text-[0.6rem] text-gold block mb-2">Good to know</span>
              <ul className="text-sm grid gap-1.5 text-pale/75">
                <li>Valid for {rules.expiryMonths} months from purchase — the expiry date is printed on the voucher.</li>
                <li>Spend it in one go or over several visits; we keep track of the balance.</li>
                <li>Redeemable against food and drink, not gratuities. Not exchangeable for cash.</li>
              </ul>
            </div>

            <label className={choice}>
              <input type="checkbox" name="terms" required />
              <span className={choiceText}>
                I agree to the{" "}
                <Link href={`/${branch.slug}/terms`} className="underline hover:text-gold">
                  Terms &amp; Conditions
                </Link>{" "}
                and understand gift vouchers are non-refundable.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <SubmitButton pendingLabel="Taking you to payment…">Continue to payment</SubmitButton>
              <span className="text-xs text-pale/70">
                You&rsquo;ll be taken to our secure payment page. The voucher is only issued once payment succeeds.
              </span>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
