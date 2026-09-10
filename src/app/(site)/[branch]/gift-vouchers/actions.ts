"use server";
import { redirect } from "next/navigation";
import { startPurchase, attachVoucherSession } from "@/lib/voucher";
import { rememberSubmission } from "@/lib/form-recall";
import { voucherRules } from "@/lib/booking-config";
import { createVoucherCheckout, stripeSimulated, paymentsUnavailable } from "@/lib/stripe";
import { guardPublicForm } from "@/lib/public-limit";
import { parsePounds, formatPence } from "@/lib/money";
import { siteUrl } from "@/lib/site";


/**
 * Creates the voucher as `pending`, then sends the buyer to pay. Exactly the
 * same rule as a table deposit: no code is issued, nobody is emailed and
 * nothing can be redeemed until Stripe says the money arrived.
 */
export async function buyVoucher(formData: FormData) {
  const branchSlug = String(formData.get("branch") ?? "");
  const validAt = String(formData.get("validAt") ?? "");   // "" = both branches
  const here = `/${branchSlug}/gift-vouchers`;
  /* Same fix as the booking form, and for the same reason with more at stake:
     a rejected voucher lost the buyer's own details, the recipient's, and the
     message they had written to go with the gift — which nobody wants to
     compose twice. The message also stops travelling in the URL, where it was
     rendered verbatim inside the site's own alert box. */
  const back = async (error: string, field?: string): Promise<string> => {
    await rememberSubmission(error, formData, here);
    return `${here}?error=1${field ? `&focus=${field}` : ""}#buy`;
  };

  if (formData.get("terms") !== "on") redirect(await back("Please accept the terms and conditions to continue."));

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
      redirect(await back(typed
        ? "We couldn't read that amount — please write it as a number, like 120."
        : "Please enter the amount you'd like to give.", "customValue"));
    }
  } else if (preset) {
    valuePence = Number(preset);
  }

  if (!valuePence || !Number.isFinite(valuePence)) {
    redirect(await back("Please choose an amount, or type your own."));
  }
  if (valuePence! < rules.minPence || valuePence! > rules.maxPence) {
    redirect(await back(
      `Please choose an amount between ${formatPence(rules.minPence)} and ${formatPence(rules.maxPence)}.`));
  }

  const guard = await guardPublicForm("voucher", { email: String(formData.get("fromEmail") ?? "") });
  if (!guard.allowed) redirect(await back(guard.message));

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

  if (!started.ok) redirect(await back(started.error));
  const { voucher } = started;

  /* No payment provider on this deployment. The purchase row exists as
     `pending` and carries no balance, so nothing has been given away — but the
     buyer must be told rather than dropped into a demo checkout that issues a
     real voucher for no money. */
  if (paymentsUnavailable()) {
    console.error(`[voucher] ${voucher.code}: STRIPE_SECRET_KEY is not set on this deployment, `
      + `so the purchase cannot be taken. No voucher has been issued.`);
    redirect(await back(
      "We can't take payment online at the moment. Please call the restaurant and we'll arrange "
      + "the voucher for you — nothing has been charged."));
  }

  const successUrl = `${siteUrl()}/${branchSlug}/gift-vouchers/confirmed?code=${encodeURIComponent(voucher.code)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl()}/${branchSlug}/gift-vouchers/unconfirmed?code=${encodeURIComponent(voucher.code)}`;

  if (stripeSimulated()) {
    /* The simulator is same-origin, so it comes back by path rather than by
       absolute URL. Real Stripe needs the absolute `successUrl` above — it is
       redirecting from its own domain — but the simulator is a page on this
       server, and sending it a fully-qualified address meant the local
       payment journey depended on SITE_URL being set correctly. It usually
       wasn't in development, so a production build run locally sent the guest
       to the live domain to collect a voucher that had been created here. */
    const path = (u: string) => u.slice(siteUrl().length) || "/";
    redirect(`/checkout-simulator?ref=${encodeURIComponent(voucher.code)}&amount=${voucher.valuePence}` +
      `&success=${encodeURIComponent(path(successUrl).replace("{CHECKOUT_SESSION_ID}", `sim_${voucher.code}`))}` +
      `&cancel=${encodeURIComponent(path(cancelUrl))}`);
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
    redirect(await back("We couldn't open the payment page just then. Please try again."));
  }

  if (!url) redirect(await back("We couldn't open the payment page just then. Please try again."));
  redirect(url);
}

