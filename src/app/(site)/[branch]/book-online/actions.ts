"use server";
import { redirect } from "next/navigation";
import { holdBooking, attachCheckoutSession, confirmPaidBooking, dateLabel } from "@/lib/booking";
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
 */
export async function startBooking(formData: FormData) {
  const branchSlug = String(formData.get("branch") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const guests = Number(formData.get("guests") ?? 0);

  const back = (error: string) =>
    `/${branchSlug}/book-online?guests=${guests}&date=${date}&time=${time}&error=${encodeURIComponent(error)}`;

  // The consents are required in the markup; re-check server-side, since markup
  // is only a suggestion to anyone posting the form directly.
  if (formData.get("terms") !== "on") redirect(back("Please accept the terms and conditions to continue."));

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

  if (!held.ok) redirect(back(held.error));

  const { booking, depositPence, branch } = held;

  // No deposit due (the restaurant switched the policy off, or the party is
  // under the threshold) — it's already confirmed, so just say so.
  if (depositPence <= 0) {
    await confirmPaidBooking({ bookingId: booking.id });
    redirect(`/${branch.slug}/book-online/confirmed?ref=${booking.reference}`);
  }

  const rules = bookingRules();
  const successUrl = `${siteUrl()}/${branch.slug}/book-online/confirmed?ref=${booking.reference}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl()}/${branch.slug}/book-online/unconfirmed?ref=${booking.reference}`;

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
    redirect(back("We couldn't open the payment page just then. Please try again, or call us and we'll book you in."));
  }

  if (!url) redirect(back("We couldn't open the payment page just then. Please try again."));
  redirect(url);
}
