"use server";
import { redirect } from "next/navigation";
import { holdBooking, attachCheckoutSession, confirmPaidBooking, dateLabel } from "@/lib/booking";
import { rememberSubmission } from "@/lib/form-recall";
import { bookingRules, prettyTime } from "@/lib/booking-config";
import { createDepositCheckout, stripeSimulated } from "@/lib/stripe";

function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Holds the table, then sends the guest to pay.
 *
 * Nothing is confirmed here. The booking is created `held` with the deposit
 * outstanding, and only the payment result (via the return page or Stripe's
 * webhook) can confirm it — so a guest who abandons the payment page never ends
 * up with a table, and never gets a confirmation email.
 *
 * WHEN IT IS REJECTED, THE GUEST GETS THEIR ANSWERS BACK
 *
 * What this replaces cost the restaurant bookings. A rejected submission
 * redirected to `?error=<the message>`, which re-rendered the page from the URL
 * alone — so every box below the party size came back empty. A guest who
 * mistyped one character of their email retyped their name, their phone, their
 * occasion, their allergies and whatever they had written in "anything else",
 * on a phone, having already decided to spend money. And they retyped it at the
 * top of a page whose form is some 1,600px further down, with nothing to say
 * where to go, because the redirect had no fragment and the alert was above the
 * calendar rather than beside the box that was wrong.
 *
 * The enquiry forms had all of this solved months ago — `rememberSubmission`
 * puts the message and the values in a sixty-second server-set cookie — and the
 * one form that takes money was the one form never moved onto it.
 *
 * The message also stops travelling in the URL, which mattered for a second
 * reason: it was rendered verbatim inside the site's own alert box, so a
 * crafted link was a ready-made phishing page wearing Varanasi's branding.
 */
export async function startBooking(formData: FormData) {
  const branchSlug = String(formData.get("branch") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const guests = Number(formData.get("guests") ?? 0);
  const here = `/${branchSlug}/book-online`;

  const back = async (error: string, field?: string): Promise<string> => {
    await rememberSubmission(error, formData, here);
    // `#your-details` lands them on the form, not the top of the page; `focus`
    // then puts the cursor in the box that was actually wrong.
    return `${here}?guests=${guests}&date=${date}&time=${time}&error=1`
      + (field ? `&focus=${field}` : "") + "#your-details";
  };

  // The consents are required in the markup; re-check server-side, since markup
  // is only a suggestion to anyone posting the form directly.
  if (formData.get("terms") !== "on") {
    redirect(await back("Please accept the terms and conditions to continue.", "terms"));
  }

  const held = holdBooking({
    branchSlug, date, time, partySize: guests,
    guestName: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    occasion: String(formData.get("occasion") ?? "") || null,
    allergens: formData.getAll("allergens").map(String),
    notes: String(formData.get("notes") ?? "") || null,
    marketingConsent: formData.get("marketing") === "on",
  });

  if (!held.ok) redirect(await back(held.error, held.field));

  const { booking, depositPence, branch } = held;

  // No deposit due (the restaurant switched the policy off, or the party is
  // under the threshold) — it's already confirmed, so just say so.
  if (depositPence <= 0) {
    await confirmPaidBooking({ bookingId: booking.id });
    redirect(`/${branch.slug}/book-online/confirmed?ref=${booking.reference}`);
  }

  const rules = bookingRules();
  const successUrl = `${siteUrl()}/${branch.slug}/book-online/confirmed?ref=${booking.reference}&session_id={CHECKOUT_SESSION_ID}`;
  /* The token goes on the cancel URL because that page releases the table.
   * Without it the only thing needed to cancel someone's hold was their
   * booking reference in a plain GET — so a link preview, an email scanner
   * or a forwarded URL would quietly release it and send a failure notice. */
  const cancelUrl = `${siteUrl()}/${branch.slug}/book-online/unconfirmed?ref=${booking.reference}&t=${booking.cancelToken ?? ""}`;

  // Without Stripe keys we hand off to the built-in simulator instead, so the
  // whole journey — including the failure path — can be demonstrated today.
  if (stripeSimulated()) {
    redirect(`/checkout-simulator?ref=${booking.reference}&amount=${depositPence}` +
      `&success=${encodeURIComponent(successUrl.replace("{CHECKOUT_SESSION_ID}", `sim_${booking.reference}`))}` +
      `&cancel=${encodeURIComponent(cancelUrl)}`);
  }

  let url: string | null = null;
  try {
    const session = await createDepositCheckout({
      amountPence: depositPence,
      bookingId: booking.id,
      reference: booking.reference,
      branchCity: branch.city,
      guestEmail: booking.email,
      partySize: booking.partySize,
      dateLabel: dateLabel(booking.date),
      timeLabel: prettyTime(booking.time),
      successUrl,
      cancelUrl,
      expiresAt: booking.holdExpiresAt ?? Math.floor(Date.now() / 1000) + rules.deposit.holdMinutes * 60,
      depositNote: rules.deposit.note,
    });
    attachCheckoutSession(booking.id, session.id);
    url = session.url;
  } catch (err) {
    console.error("[booking] could not open a payment page:", err);
    redirect(await back("We couldn't open the payment page just then. Please try again, or call us and we'll book you in."));
  }

  if (!url) redirect(await back("We couldn't open the payment page just then. Please try again."));
  redirect(url);
}
