"use server";
import { redirect } from "next/navigation";
import { startPurchase, attachVoucherSession } from "@/lib/voucher";
import { voucherRules } from "@/lib/booking-config";
import { createVoucherCheckout, stripeSimulated } from "@/lib/stripe";
import { parsePounds, formatPence } from "@/lib/money";

function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Creates the voucher as `pending`, then sends the buyer to pay. Exactly the
 * same rule as a table deposit: no code is issued, nobody is emailed and
 * nothing can be redeemed until Stripe says the money arrived.
 */
export async function buyVoucher(formData: FormData) {
  const branchSlug = String(formData.get("branch") ?? "");
  const validAt = String(formData.get("validAt") ?? "");   // "" = both branches
  const back = (error: string) =>
    `/${branchSlug}/gift-vouchers?error=${encodeURIComponent(error)}`;

  if (formData.get("terms") !== "on") redirect(back("Please accept the terms and conditions to continue."));

  // A preset button, or a custom amount
  const preset = String(formData.get("value") ?? "");
  const typed = String(formData.get("customValue") ?? "").trim();
  const rules = voucherRules();
  let valuePence: number | null = null;

  /* Typing an amount means that amount. Previously the box was only read when
   * the "Another amount" radio had also been clicked, so someone who filled in
   * 500 and pressed continue was charged the £50 default — silently, with the
   * only warning in 12px grey text. A guest intending a £500 gift found out
   * afterwards, if at all. Typing now wins over any preset. */
  if (preset === "custom" || typed) {
    valuePence = parsePounds(typed);
    if (valuePence == null) {
      redirect(back(typed
        ? "We couldn't read that amount — please write it as a number, like 120."
        : "Please enter the amount you'd like to give."));
    }
  } else if (preset) {
    valuePence = Number(preset);
  }

  if (!valuePence || !Number.isFinite(valuePence)) {
    redirect(back("Please choose an amount, or type your own."));
  }
  if (valuePence! < rules.minPence || valuePence! > rules.maxPence) {
    redirect(back(
      `Please choose an amount between ${formatPence(rules.minPence)} and ${formatPence(rules.maxPence)}.`));
  }

  const started = startPurchase({
    branchSlug: validAt || null,
    valuePence: valuePence!,
    purchaserName: String(formData.get("fromName") ?? ""),
    purchaserEmail: String(formData.get("fromEmail") ?? ""),
    recipientName: String(formData.get("toName") ?? ""),
    recipientEmail: String(formData.get("toEmail") ?? ""),
    message: String(formData.get("message") ?? "") || null,
    deliverOn: String(formData.get("deliverOn") ?? "") || null,
  });

  if (!started.ok) redirect(back(started.error));
  const { voucher } = started;

  const successUrl = `${siteUrl()}/${branchSlug}/gift-vouchers/confirmed?code=${encodeURIComponent(voucher.code)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl()}/${branchSlug}/gift-vouchers/unconfirmed?code=${encodeURIComponent(voucher.code)}`;

  if (stripeSimulated()) {
    redirect(`/checkout-simulator?ref=${encodeURIComponent(voucher.code)}&amount=${voucher.valuePence}` +
      `&success=${encodeURIComponent(successUrl.replace("{CHECKOUT_SESSION_ID}", `sim_${voucher.code}`))}` +
      `&cancel=${encodeURIComponent(cancelUrl)}`);
  }

  let url: string | null = null;
  try {
    const session = await createVoucherCheckout({
      amountPence: voucher.valuePence,
      voucherId: voucher.id,
      code: voucher.code,
      purchaserEmail: voucher.purchaserEmail,
      recipientName: voucher.recipientName ?? "",
      validAt: started.branch ? `Varanasi ${started.branch.city}` : "Birmingham or Leicester",
      successUrl,
      cancelUrl,
    });
    attachVoucherSession(voucher.id, session.id);
    url = session.url;
  } catch (err) {
    console.error("[voucher] could not open a payment page:", err);
    redirect(back("We couldn't open the payment page just then. Please try again."));
  }

  if (!url) redirect(back("We couldn't open the payment page just then. Please try again."));
  redirect(url);
}

