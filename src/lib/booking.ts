import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { bookings, branches } from "@/db/schema";
import { branchBySlug, type Branch } from "@/lib/branches";
import { bookingRules, depositFor, prettyTime, followUpRules, whatsappRules } from "@/lib/booking-config";
import { slotStillAvailable } from "@/lib/availability";
import { formatPence } from "@/lib/money";
import { sendMail } from "@/lib/email";
import { checkName, checkEmail, checkPhone } from "@/lib/validate";
import { sendWhatsApp, toE164 } from "@/lib/whatsapp";
import { issueThankYouVoucher, expiryLabel } from "@/lib/voucher";

export type Booking = typeof bookings.$inferSelect;

/** "VB-4K7QP2" — short enough to read over the phone, random enough not to guess. */
function reference(branchSlug: string): string {
  const prefix = branchSlug === "leicester" ? "VL" : "VB";
  const body = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `${prefix}-${body}`;
}

export function dateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

/**
 * Release holds whose payment window has closed.
 *
 * Called before availability is shown and before a new hold is taken, which is
 * enough to keep abandoned checkouts from blocking tables without needing a
 * background job — there's no scheduler on this hosting, and a booking site
 * gets plenty of traffic to trigger it.
 */
export function expireStaleHolds(): number {
  const now = Math.floor(Date.now() / 1000);
  const stale = db.select({ id: bookings.id }).from(bookings)
    .where(and(eq(bookings.status, "held"), lt(bookings.holdExpiresAt, now))).all();
  if (!stale.length) return 0;
  db.update(bookings)
    .set({ status: "cancelled", depositStatus: "failed" })
    .where(and(eq(bookings.status, "held"), lt(bookings.holdExpiresAt, now)))
    .run();
  return stale.length;
}

export type HoldInput = {
  branchSlug: string;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  email: string;
  phone: string;
  occasion?: string | null;
  allergens?: string[];
  notes?: string | null;
  marketingConsent: boolean;
};

export type HoldResult =
  | { ok: true; booking: Booking; depositPence: number; branch: Branch }
  | { ok: false; error: string };

/**
 * Take the table off the market and create the booking as `held`.
 * Nothing is confirmed and nobody is emailed until the deposit is paid.
 */
export function holdBooking(input: HoldInput): HoldResult {
  const branch = branchBySlug(input.branchSlug);
  if (!branch || !branch.isPublished) return { ok: false, error: "That restaurant isn't taking bookings." };

  expireStaleHolds();

  const rules = bookingRules();
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1) return { ok: false, error: "Please tell us how many guests are coming." };
  if (partySize > rules.capacity.maxPartyOnline) {
    return { ok: false, error: `For parties of more than ${rules.capacity.maxPartyOnline}, please call us on ${branch.phone}.` };
  }
  // Contact details are checked properly rather than merely for being
  // non-empty: the phone box used to accept "1", which is a table the
  // restaurant cannot ring about a late arrival. See src/lib/validate.ts for
  // why these rules are deliberately permissive.
  const name = checkName(input.guestName);
  if (!name.ok) return { ok: false, error: name.error };
  const email = checkEmail(input.email);
  if (!email.ok) return { ok: false, error: email.error };
  const phone = checkPhone(input.phone, true);
  if (!phone.ok) return { ok: false, error: phone.error };

  // Re-check availability at the moment of booking, not just when the slots
  // were rendered — two guests can reach the last table at the same time.
  if (!slotStillAvailable(branch, input.date, input.time, partySize)) {
    return { ok: false, error: "Sorry — that time has just gone. Please pick another." };
  }

  const depositPence = depositFor(rules, input.date, partySize);
  const now = Math.floor(Date.now() / 1000);

  const created = db.insert(bookings).values({
    reference: reference(branch.slug),
    branchId: branch.id,
    // Name with collapsed whitespace, email lowercased, phone as the guest
    // typed it — staff recognise and search on the form they were given, and
    // the WhatsApp sender derives E.164 itself when it needs to dial.
    guestName: name.value,
    email: email.value,
    phone: phone.value,
    partySize,
    date: input.date,
    time: input.time,
    occasion: input.occasion?.trim() || null,
    dietary: input.allergens?.length ? input.allergens.join(",") : null,
    notes: input.notes?.trim() || null,
    // no deposit due (policy off / below threshold) means it's confirmed outright
    status: depositPence > 0 ? "held" : "confirmed",
    depositPence: depositPence > 0 ? depositPence : null,
    depositStatus: depositPence > 0 ? "required" : "none",
    holdExpiresAt: depositPence > 0 ? now + rules.deposit.holdMinutes * 60 : null,
    marketingConsent: input.marketingConsent,
    termsAcceptedAt: now,
    cancelToken: crypto.randomBytes(16).toString("hex"),
    source: "website",
  }).returning().get();

  return { ok: true, booking: created, depositPence, branch };
}

export function bookingById(id: number): Booking | undefined {
  return db.select().from(bookings).where(eq(bookings.id, id)).get();
}
export function bookingByReference(ref: string): Booking | undefined {
  return db.select().from(bookings).where(eq(bookings.reference, ref.trim().toUpperCase())).get();
}
export function bookingBySessionId(sessionId: string): Booking | undefined {
  return db.select().from(bookings).where(eq(bookings.stripeSessionId, sessionId)).get();
}

export function attachCheckoutSession(bookingId: number, sessionId: string): void {
  db.update(bookings).set({ stripeSessionId: sessionId }).where(eq(bookings.id, bookingId)).run();
}

/**
 * Mark a deposit paid and confirm the booking — the fulfilment step.
 *
 * Safe to call repeatedly and concurrently: Stripe's own guidance is that this
 * runs from both the webhook and the return page, so it checks whether the
 * booking is already confirmed and does nothing (and re-sends nothing) if so.
 */
export async function confirmPaidBooking(opts: {
  bookingId: number;
  paymentIntent?: string | null;
  sessionId?: string | null;
}): Promise<{ confirmed: boolean; alreadyDone: boolean; booking?: Booking }> {
  const existing = bookingById(opts.bookingId);
  if (!existing) return { confirmed: false, alreadyDone: false };

  if (existing.depositStatus === "captured" && existing.status !== "cancelled") {
    return { confirmed: true, alreadyDone: true, booking: existing };
  }

  const now = Math.floor(Date.now() / 1000);
  db.update(bookings).set({
    status: "confirmed",
    depositStatus: "captured",
    depositPaidAt: now,
    holdExpiresAt: null,
    stripePaymentIntent: opts.paymentIntent ?? existing.stripePaymentIntent,
    stripeSessionId: opts.sessionId ?? existing.stripeSessionId,
  }).where(eq(bookings.id, opts.bookingId)).run();

  const booking = bookingById(opts.bookingId)!;
  await notifyConfirmed(booking);
  return { confirmed: true, alreadyDone: false, booking };
}

/** A deposit that failed or a checkout that expired — the table goes back. */
export function markPaymentFailed(bookingId: number): void {
  const b = bookingById(bookingId);
  if (!b || b.depositStatus === "captured") return;
  db.update(bookings).set({ status: "cancelled", depositStatus: "failed", holdExpiresAt: null })
    .where(eq(bookings.id, bookingId)).run();
}

export function cancelByToken(reference: string, token: string): { ok: boolean; error?: string } {
  const b = bookingByReference(reference);
  if (!b || !b.cancelToken || b.cancelToken !== token) return { ok: false, error: "We couldn't find that booking." };
  if (b.status === "cancelled") return { ok: true };
  if (!["held", "confirmed"].includes(b.status)) return { ok: false, error: "That booking can no longer be cancelled online — please call us." };
  db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.id)).run();
  void notifyCancelled(b);
  return { ok: true };
}

/* ---------------- emails ---------------- */

function branchFor(booking: Booking): Branch | undefined {
  return db.select().from(branches).where(eq(branches.id, booking.branchId)).get();
}

function summary(b: Booking, branch?: Branch): string {
  const lines = [
    `Reference:  ${b.reference}`,
    `Restaurant: Varanasi ${branch?.city ?? ""}${branch ? ` — ${branch.addressLine}, ${branch.postcode}` : ""}`,
    `Date:       ${dateLabel(b.date)}`,
    `Time:       ${prettyTime(b.time)}`,
    `Guests:     ${b.partySize}`,
    `Name:       ${b.guestName}`,
    `Phone:      ${b.phone ?? "—"}`,
    `Email:      ${b.email ?? "—"}`,
  ];
  if (b.occasion) lines.push(`Occasion:   ${b.occasion}`);
  if (b.dietary) lines.push(`Allergens:  ${b.dietary.split(",").join(", ")}`);
  if (b.notes) lines.push(`Notes:      ${b.notes}`);
  if (b.depositPence) lines.push(`Deposit:    ${formatPence(b.depositPence)} paid`);
  return lines.join("\n");
}

/** To the guest, and to the restaurant, once the deposit is actually paid. */
export async function notifyConfirmed(b: Booking): Promise<void> {
  const rules = bookingRules();
  const branch = branchFor(b);
  const site = process.env.SITE_URL ?? "https://varanasi.uk";
  const manageUrl = `${site}/${branch?.slug ?? ""}/booking/${b.reference}?t=${b.cancelToken}`;

  await sendMail({
    to: b.email ? [b.email] : [],
    subject: `Your table at Varanasi ${branch?.city ?? ""} is confirmed — ${b.reference}`,
    replyTo: rules.notifications.replyTo,
    fromName: rules.notifications.fromName,
    fromEmail: rules.notifications.fromEmail,
    text:
`Dear ${b.guestName},

Thank you — your table is confirmed and your deposit has been received.

${summary(b, branch)}

Your deposit is deducted from your final bill.

Need to change or cancel? Please give us at least 24 hours' notice:
${manageUrl}

Or call us on ${branch?.phone ?? ""}.

We look forward to welcoming you.

Varanasi ${branch?.city ?? ""}
${branch?.addressLine ?? ""}, ${branch?.postcode ?? ""}`,
  });

  // WhatsApp, where we have a usable number and the guest agreed to it.
  const wa = whatsappRules();
  if (wa.enabled && b.phone && toE164(b.phone)) {
    await sendWhatsApp({
      to: b.phone,
      kind: "booking-confirmed",
      template: wa.templates.bookingConfirmed,
      variables: [
        b.guestName.split(" ")[0],
        branch?.city ?? "",
        dateLabel(b.date),
        prettyTime(b.time),
        String(b.partySize),
        b.reference,
      ],
    });
  }

  // And the restaurant's own phone. Email is where the detail lives, but a
  // deposit-paid booking is something the floor wants to know about now, not
  // whenever somebody next opens an inbox. Same Meta constraint as every other
  // message here: it needs an approved template before it will deliver, and
  // until then it is written to data/outbox where the wording can be checked.
  if (wa.enabled && wa.notifyTo && toE164(wa.notifyTo)) {
    await sendWhatsApp({
      to: wa.notifyTo,
      kind: "staff-new-booking",
      template: wa.templates.staffNewBooking ?? "varanasi_staff_new_booking",
      variables: [
        b.guestName.split(" ")[0],
        branch?.city ?? "",
        dateLabel(b.date),
        prettyTime(b.time),
        String(b.partySize),
        b.reference,
      ],
    });
  }

  if (rules.notifications.to.length) {
    await sendMail({
      to: rules.notifications.to,
      subject: `New booking — ${branch?.city ?? ""} — ${dateLabel(b.date)} ${prettyTime(b.time)} — ${b.partySize} guests`,
      replyTo: b.email ?? undefined,
      fromName: rules.notifications.fromName,
      fromEmail: rules.notifications.fromEmail,
      text:
`A new booking has been paid for and confirmed on the website.

${summary(b, branch)}

Marketing consent: ${b.marketingConsent ? "yes" : "no"}
Booked at: ${new Date((b.createdAt ?? 0) * 1000).toUTCString()}

See it in the admin: ${site}/admin/bookings?branch=${branch?.slug ?? ""}`,
    });
  }
}

/** Told the guest their payment didn't go through, so nothing is reserved. */
export async function notifyPaymentFailed(b: Booking): Promise<void> {
  const rules = bookingRules();
  const branch = branchFor(b);
  const site = process.env.SITE_URL ?? "https://varanasi.uk";
  if (!b.email) return;

  await sendMail({
    to: [b.email],
    subject: `Your Varanasi booking was not confirmed — payment unsuccessful`,
    replyTo: rules.notifications.replyTo,
    fromName: rules.notifications.fromName,
    fromEmail: rules.notifications.fromEmail,
    text:
`Dear ${b.guestName},

Your payment was not successful, so your booking has NOT been confirmed and no table is being held for you.

What you asked for:
${summary(b, branch)}

Nothing has been charged. To try again, please rebook here:
${site}/${branch?.slug ?? ""}/book-online

If you'd rather book over the phone, call us on ${branch?.phone ?? ""} and we'll take care of it.

Varanasi ${branch?.city ?? ""}`,
  });

  // The restaurant is told too. A failed payment is a guest who wanted a
  // table and didn't get one — which is a booking that can often be rescued
  // with a phone call, but only if somebody knows it happened. Previously
  // this went to the guest alone and the attempt vanished.
  if (rules.notifications.to.length) {
    await sendMail({
      to: rules.notifications.to,
      subject: `Payment failed — ${branch?.city ?? ""} — ${dateLabel(b.date)} ${prettyTime(b.time)} — ${b.partySize} guests`,
      fromName: rules.notifications.fromName,
      fromEmail: rules.notifications.fromEmail,
      replyTo: b.email ?? undefined,
      text:
`A guest tried to book and their deposit payment did not go through, so no
table is being held. They may appreciate a call.

${summary(b, branch)}

Nothing was charged. Reply to this email to reach them directly.

See it in the admin: ${site}/admin/bookings?branch=${branch?.slug ?? ""}`,
    });
  }
}

async function notifyCancelled(b: Booking): Promise<void> {
  const rules = bookingRules();
  const branch = branchFor(b);
  const site = process.env.SITE_URL ?? "https://varanasi.uk";

  if (rules.notifications.to.length) {
    await sendMail({
      to: rules.notifications.to,
      subject: `Booking cancelled — ${branch?.city ?? ""} — ${dateLabel(b.date)} ${prettyTime(b.time)} — ${b.reference}`,
      fromName: rules.notifications.fromName,
      fromEmail: rules.notifications.fromEmail,
      text: `A guest cancelled their booking online.\n\n${summary(b, branch)}`,
    });
  }

  // And a receipt for the guest. Cancelling online used to be silent from
  // their side, which leaves someone wondering whether it worked — so they
  // ring to check, which is the phone call the online cancellation existed to
  // avoid. It also puts the reference in writing if there is ever a dispute
  // about a deposit.
  if (!b.email) return;
  await sendMail({
    to: [b.email],
    subject: `Your Varanasi booking has been cancelled — ${b.reference}`,
    replyTo: rules.notifications.replyTo,
    fromName: rules.notifications.fromName,
    fromEmail: rules.notifications.fromEmail,
    text:
`Dear ${b.guestName},

Your booking has been cancelled, as you asked. Nothing further is reserved
and we won't be expecting you.

The booking that was cancelled:
${summary(b, branch)}

If any deposit is due back to you, we'll deal with that separately and be in
touch — there is nothing more for you to do.

We hope to see you another time. To book again:
${site}/${branch?.slug ?? ""}/book-online

Varanasi ${branch?.city ?? ""}
${branch?.phone ?? ""}`,
  });
}

/** Bookings that still hold a table, for the availability calculation and admin. */
export function liveStatuses() {
  return inArray(bookings.status, ["held", "confirmed", "seated"]);
}

/* ---------------- after they've dined ---------------- */

/**
 * The thank-you: a Google review link and a complimentary voucher towards the
 * next visit. Fires when a booking is marked `completed`, and stamps
 * `followUpSentAt` so re-marking a booking can't send it twice or mint a
 * second voucher.
 *
 * Deliberately does nothing for a booking that was cancelled or a no-show —
 * asking someone who never ate for a review is worse than saying nothing.
 */
export async function sendPostDiningFollowUp(bookingId: number): Promise<{ sent: boolean; reason?: string }> {
  const rules = followUpRules();
  if (!rules.enabled) return { sent: false, reason: "follow-up is switched off" };

  const b = bookingById(bookingId);
  if (!b) return { sent: false, reason: "booking not found" };
  if (b.followUpSentAt) return { sent: false, reason: "already sent" };
  if (b.status !== "completed") return { sent: false, reason: `status is ${b.status}, not completed` };
  if (!b.email && !b.phone) return { sent: false, reason: "no way to contact this guest" };

  const branch = branchFor(b);
  const site = (process.env.SITE_URL ?? "https://varanasi.uk").replace(/\/$/, "");
  const reviewUrl = branch ? (rules.reviewUrl[branch.slug] || "") : "";
  const firstName = b.guestName.split(" ")[0];

  // The complimentary voucher, if one is configured.
  let voucher = null;
  if (rules.complimentaryPence > 0) {
    voucher = await issueThankYouVoucher({
      branchId: b.branchId,
      bookingId: b.id,
      name: b.guestName,
      email: b.email,
      valuePence: rules.complimentaryPence,
      expiryDays: rules.complimentaryExpiryDays,
    });
  }

  const voucherBlock = voucher
    ? `\nAnd a small thank you: ${formatPence(voucher.valuePence)} off your next visit.\n\n` +
      `  Code:        ${voucher.code}\n` +
      `  Valid until: ${expiryLabel(voucher)}\n` +
      `  Valid at:    Varanasi ${branch?.city ?? ""}\n\n` +
      `Just quote the code when you book or when you settle the bill.\n`
    : "";

  const reviewBlock = reviewUrl
    ? `\nIf you enjoyed your evening, a Google review genuinely helps us —\nit takes less than a minute:\n\n  ${reviewUrl}\n`
    : "";

  if (b.email) {
    await sendMail({
      to: [b.email],
      subject: `Thank you for dining with us, ${firstName}`,
      replyTo: bookingRules().notifications.replyTo,
      fromName: bookingRules().notifications.fromName,
      fromEmail: bookingRules().notifications.fromEmail,
      text:
`Dear ${firstName},

Thank you for dining with us at Varanasi ${branch?.city ?? ""}. It was a
pleasure to have you, and we hope every course was worth the trip.
${reviewBlock}${voucherBlock}
We'd love to see you again: ${site}/${branch?.slug ?? ""}/book-online

With our warmest regards,
Varanasi ${branch?.city ?? ""}
${branch?.addressLine ?? ""}, ${branch?.postcode ?? ""}`,
    });
  }

  const wa = whatsappRules();
  if (wa.enabled && b.phone && toE164(b.phone)) {
    await sendWhatsApp({
      to: b.phone,
      kind: "thank-you",
      template: wa.templates.thankYou,
      variables: [
        branch?.city ?? "",
        firstName,
        reviewUrl || `${site}/${branch?.slug ?? ""}`,
        voucher ? formatPence(voucher.valuePence) : "a treat",
        voucher?.code ?? "—",
        voucher ? expiryLabel(voucher) : "—",
      ],
    });
  }

  db.update(bookings).set({ followUpSentAt: Math.floor(Date.now() / 1000) })
    .where(eq(bookings.id, b.id)).run();

  return { sent: true };
}
