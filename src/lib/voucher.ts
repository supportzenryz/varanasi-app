import "server-only";
import crypto from "node:crypto";
import { and, eq, lte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { vouchers, voucherRedemptions, branches } from "@/db/schema";
import { branchBySlug, type Branch } from "@/lib/branches";
import { voucherRules } from "@/lib/booking-config";
import { formatPence } from "@/lib/money";
import { checkName, checkEmail } from "@/lib/validate";
import { sendMail } from "@/lib/email";
import { sendWhatsApp } from "@/lib/whatsapp";

export type Voucher = typeof vouchers.$inferSelect;

/**
 * Gift voucher codes.
 *
 * A voucher code is money, so it can't be guessable: 12 characters from a
 * 32-letter alphabet with the easily-confused ones (I, O, 0, 1) removed is
 * ~60 bits, generated from a CSPRNG. Grouped in fours so it can be read out
 * over the phone and typed off a printed card.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `VG-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

/** Codes are unique, and a collision must never silently overwrite one. */
function uniqueCode(): string {
  for (let i = 0; i < 8; i++) {
    const code = generateCode();
    if (!db.select({ id: vouchers.id }).from(vouchers).where(eq(vouchers.code, code)).get()) return code;
  }
  throw new Error("could not generate a unique voucher code");
}

export function normaliseCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^VG/, "");
  return `VG-${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 12)}`;
}

export function voucherByCode(code: string): Voucher | undefined {
  const exact = db.select().from(vouchers).where(eq(vouchers.code, code.trim().toUpperCase())).get();
  if (exact) return exact;
  return db.select().from(vouchers).where(eq(vouchers.code, normaliseCode(code))).get();
}
export function voucherById(id: number): Voucher | undefined {
  return db.select().from(vouchers).where(eq(vouchers.id, id)).get();
}
export function voucherBySession(sessionId: string): Voucher | undefined {
  return db.select().from(vouchers).where(eq(vouchers.stripeSessionId, sessionId)).get();
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function expiryLabel(v: Voucher): string {
  if (!v.expiresAt) return "No expiry";
  return new Date(v.expiresAt * 1000).toLocaleDateString("en-GB",
    { day: "numeric", month: "long", year: "numeric" });
}

/* ---------------- purchase ---------------- */

export type PurchaseInput = {
  branchSlug: string | null;      // null = valid at both restaurants
  valuePence: number;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone?: string | null;
  message?: string | null;
  deliverOn?: string | null;      // ISO date, null = send as soon as it's paid
};

export type PurchaseResult =
  | { ok: true; voucher: Voucher; branch: Branch | null }
  | { ok: false; error: string };

/**
 * Creates the voucher as `pending` — it carries no balance and cannot be
 * redeemed until Stripe confirms the payment. Same rule as a table deposit:
 * nothing is real until the money is.
 */
export function startPurchase(input: PurchaseInput): PurchaseResult {
  const rules = voucherRules();
  const branch = input.branchSlug ? branchBySlug(input.branchSlug) ?? null : null;
  if (input.branchSlug && !branch) return { ok: false, error: "That restaurant isn't available." };

  const value = Math.round(Number(input.valuePence));
  if (!Number.isInteger(value) || value < rules.minPence || value > rules.maxPence) {
    return { ok: false, error: `Please choose an amount between ${formatPence(rules.minPence)} and ${formatPence(rules.maxPence)}.` };
  }
  /* The same checks as every other form on the site. This one had the weakest
   * validation of all of them — a bare regex that accepted a@b.c and, more to
   * the point, accepted gmial.com without comment. That matters most here: the
   * voucher is paid for and then sent to a third party who has no idea it was
   * coming, so a mistyped recipient address is a gift that vanishes and nobody
   * reports. */
  const buyerName = checkName(input.purchaserName);
  if (!buyerName.ok) return { ok: false, error: buyerName.error };
  const buyerEmail = checkEmail(input.purchaserEmail);
  if (!buyerEmail.ok) {
    return { ok: false, error: buyerEmail.error.replace("your confirmation", "your receipt") };
  }
  const toName = checkName(input.recipientName);
  if (!toName.ok) return { ok: false, error: "Please tell us who the voucher is for." };
  const toEmail = checkEmail(input.recipientEmail);
  if (!toEmail.ok) {
    return { ok: false, error: `For the recipient: ${toEmail.error[0].toLowerCase()}${toEmail.error.slice(1)}` };
  }
  if (input.message && input.message.length > 500) {
    return { ok: false, error: "Please keep your message under 500 characters." };
  }
  if (input.deliverOn) {
    const today = new Date().toISOString().slice(0, 10);
    if (input.deliverOn < today) return { ok: false, error: "The delivery date can't be in the past." };
    // A voucher expires 12 months from purchase, so scheduling delivery beyond
    // that sends a gift that has already run out. 2099 was accepted before.
    const latest = new Date();
    latest.setMonth(latest.getMonth() + rules.expiryMonths);
    if (input.deliverOn > latest.toISOString().slice(0, 10)) {
      return {
        ok: false,
        error: `Please choose a delivery date within the next ${rules.expiryMonths} months — ` +
          `the voucher expires after that.`,
      };
    }
  }

  const created = db.insert(vouchers).values({
    code: uniqueCode(),
    valuePence: value,
    balancePence: 0,                 // credited only once paid
    status: "pending",
    purchaserName: buyerName.value,
    purchaserEmail: buyerEmail.value,
    recipientName: toName.value,
    recipientEmail: toEmail.value,
    message: input.message?.trim() || null,
    branchId: branch?.id ?? null,
    deliverOn: input.deliverOn || null,
    origin: "purchase",
  }).returning().get();

  return { ok: true, voucher: created, branch };
}

export function attachVoucherSession(voucherId: number, sessionId: string): void {
  db.update(vouchers).set({ stripeSessionId: sessionId }).where(eq(vouchers.id, voucherId)).run();
}

/**
 * Activate a paid voucher — the fulfilment step. Idempotent, because it runs
 * from both Stripe's webhook and the return page.
 */
export async function activatePaidVoucher(opts: {
  voucherId: number;
  paymentIntent?: string | null;
  sessionId?: string | null;
}): Promise<{ activated: boolean; alreadyDone: boolean; voucher?: Voucher }> {
  const existing = voucherById(opts.voucherId);
  if (!existing) return { activated: false, alreadyDone: false };
  if (existing.status !== "pending") return { activated: true, alreadyDone: true, voucher: existing };

  const rules = voucherRules();
  const now = Math.floor(Date.now() / 1000);
  const expires = Math.floor(addMonths(new Date(), rules.expiryMonths).getTime() / 1000);

  db.update(vouchers).set({
    status: "active",
    balancePence: existing.valuePence,
    issuedAt: now,
    expiresAt: expires,
    stripePaymentIntent: opts.paymentIntent ?? existing.stripePaymentIntent,
    stripeSessionId: opts.sessionId ?? existing.stripeSessionId,
  }).where(eq(vouchers.id, opts.voucherId)).run();

  const voucher = voucherById(opts.voucherId)!;

  // Always receipt the buyer. Only send the voucher itself now if it isn't
  // being held for a future date.
  await notifyPurchaser(voucher);
  const today = new Date().toISOString().slice(0, 10);
  if (!voucher.deliverOn || voucher.deliverOn <= today) await deliverVoucher(voucher);

  return { activated: true, alreadyDone: false, voucher };
}

export function markPurchaseFailed(voucherId: number): void {
  const v = voucherById(voucherId);
  if (!v || v.status !== "pending") return;
  db.update(vouchers).set({ status: "cancelled" }).where(eq(vouchers.id, voucherId)).run();
}

/* ---------------- delivery ---------------- */

function branchOf(v: Voucher): Branch | undefined {
  if (!v.branchId) return undefined;
  return db.select().from(branches).where(eq(branches.id, v.branchId)).get();
}

function whereValid(v: Voucher): string {
  const b = branchOf(v);
  return b ? `Varanasi ${b.city}` : "either Varanasi restaurant — Birmingham or Leicester";
}

/** Sends the voucher to the recipient, and stamps it so it goes only once. */
export async function deliverVoucher(v: Voucher): Promise<void> {
  if (v.deliveredAt) return;
  const rules = voucherRules();
  const site = (process.env.SITE_URL ?? "https://varanasi.uk").replace(/\/$/, "");

  await sendMail({
    to: v.recipientEmail ? [v.recipientEmail] : [],
    subject: `${v.purchaserName} has sent you a Varanasi gift voucher`,
    replyTo: rules.replyTo,
    fromName: rules.fromName,
    fromEmail: rules.fromEmail,
    text:
`Dear ${v.recipientName},

${v.purchaserName} has sent you a Varanasi gift voucher worth ${formatPence(v.valuePence)}.
${v.message ? `\nTheir message:\n\n  "${v.message}"\n` : ""}
Your voucher code:  ${v.code}
Value:              ${formatPence(v.valuePence)}
Valid at:           ${whereValid(v)}
Valid until:        ${expiryLabel(v)}

How to use it: quote the code when you book, or hand it to us when you settle
the bill. You don't have to spend it all at once — we'll keep track of the
balance for you.

Book a table: ${site}

We look forward to welcoming you.

Varanasi Restaurant`,
  });

  if (v.recipientEmail) {
    // A voucher is a nice thing to get on WhatsApp too, where we have a number.
    // (No number is stored for gift purchases yet — kept here for when the
    // form starts asking, and used by the thank-you voucher, which has one.)
  }

  db.update(vouchers).set({ deliveredAt: Math.floor(Date.now() / 1000) })
    .where(eq(vouchers.id, v.id)).run();
}

async function notifyPurchaser(v: Voucher): Promise<void> {
  const rules = voucherRules();
  if (!v.purchaserEmail) return;
  const when = v.deliverOn
    ? `We'll send it to ${v.recipientName} on ${new Date(`${v.deliverOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.`
    : `We've sent it straight to ${v.recipientName} at ${v.recipientEmail}.`;

  await sendMail({
    to: [v.purchaserEmail],
    subject: `Your Varanasi gift voucher purchase — ${formatPence(v.valuePence)}`,
    replyTo: rules.replyTo,
    fromName: rules.fromName,
    fromEmail: rules.fromEmail,
    text:
`Dear ${v.purchaserName},

Thank you — your gift voucher is paid for and confirmed.

Value:      ${formatPence(v.valuePence)}
For:        ${v.recipientName} (${v.recipientEmail})
Code:       ${v.code}
Valid at:   ${whereValid(v)}
Valid until: ${expiryLabel(v)}

${when}

If anything looks wrong, reply to this email and we'll put it right.

Varanasi Restaurant`,
  });

  if (rules.notifyTo.length) {
    await sendMail({
      to: rules.notifyTo,
      subject: `Gift voucher sold — ${formatPence(v.valuePence)} — ${v.code}`,
      fromName: rules.fromName,
      fromEmail: rules.fromEmail,
      text:
`A gift voucher has been purchased on the website.

Code:       ${v.code}
Value:      ${formatPence(v.valuePence)}
Bought by:  ${v.purchaserName} (${v.purchaserEmail})
For:        ${v.recipientName} (${v.recipientEmail})
Valid at:   ${whereValid(v)}
Expires:    ${expiryLabel(v)}
Delivery:   ${v.deliverOn ? `scheduled for ${v.deliverOn}` : "sent immediately"}
${v.message ? `Message:    "${v.message}"` : ""}`,
    });
  }
}

/**
 * Vouchers bought for a future date.
 *
 * This was called from one admin button and nowhere else, which meant a gift
 * bought in November for Christmas morning was delivered only if a member of
 * staff happened to press that button on the day. Otherwise the buyer's
 * confirmation said "we'll send it on 25 December" and nothing ever did — a
 * paid gift that silently never arrives, and the recipient has no idea to
 * chase it. Now also run hourly by the scheduler in src/lib/backup.ts.
 */
export async function deliverDueVouchers(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.select().from(vouchers)
    .where(and(
      eq(vouchers.status, "active"),
      isNull(vouchers.deliveredAt),
      or(isNull(vouchers.deliverOn), lte(vouchers.deliverOn, today)),
    )).all();
  for (const v of due) await deliverVoucher(v);
  return due.length;
}

/** Marks anything past its expiry, so a stale code can't be redeemed. */
export function expireOldVouchers(): number {
  const now = Math.floor(Date.now() / 1000);
  const stale = db.select({ id: vouchers.id }).from(vouchers)
    .where(and(eq(vouchers.status, "active"), lte(vouchers.expiresAt, now))).all();
  if (stale.length) {
    db.update(vouchers).set({ status: "expired" })
      .where(and(eq(vouchers.status, "active"), lte(vouchers.expiresAt, now))).run();
  }
  return stale.length;
}

/* ---------------- redemption ---------------- */

export type RedeemResult = { ok: true; voucher: Voucher; remaining: number } | { ok: false; error: string };

/**
 * Take an amount off a voucher. Partial redemption is the point — a £100
 * voucher against a £64 bill leaves £36 on the card, and the ledger records
 * who took what, when and at which branch.
 */
export function redeem(opts: {
  code: string;
  amountPence: number;
  branchId: number | null;
  userId: number;
  note?: string | null;
  /**
   * The balance the screen was showing when the button was pressed.
   *
   * A redemption is money leaving the business, and this action had no guard
   * against being applied twice: re-posting the same request took the amount
   * again, and again, each time reporting success. A double-tap behind a bar
   * did the same thing. Carrying the balance the form was rendered with turns
   * that into a refusal — a replayed or stale submission no longer matches
   * what is in the database, so only the first one lands. It also settles the
   * case of two staff redeeming the same voucher at once.
   */
  expectedBalancePence?: number | null;
}): RedeemResult {
  expireOldVouchers();
  const v = voucherByCode(opts.code);
  if (!v) return { ok: false, error: "No voucher found with that code." };

  if (v.status === "pending") return { ok: false, error: "That voucher hasn't been paid for yet." };
  if (v.status === "cancelled") return { ok: false, error: "That voucher has been cancelled." };
  if (v.status === "expired") return { ok: false, error: `That voucher expired on ${expiryLabel(v)}.` };
  if (v.status === "redeemed" || v.balancePence <= 0) return { ok: false, error: "That voucher has already been fully used." };

  // A branch-specific voucher can't be spent at the other restaurant.
  if (v.branchId && opts.branchId && v.branchId !== opts.branchId) {
    const b = branchOf(v);
    return { ok: false, error: `That voucher is only valid at Varanasi ${b?.city ?? "the other branch"}.` };
  }

  if (
    opts.expectedBalancePence != null &&
    Number(opts.expectedBalancePence) !== v.balancePence
  ) {
    return {
      ok: false,
      error:
        `This voucher has changed since the page was opened — it now holds ` +
        `${formatPence(v.balancePence)}. Nothing has been taken off. Please check and try again.`,
    };
  }

  const amount = Math.round(Number(opts.amountPence));
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: "Enter the amount to take off the voucher." };
  if (amount > v.balancePence) {
    return { ok: false, error: `That's more than the voucher holds — ${formatPence(v.balancePence)} remaining.` };
  }

  const remaining = v.balancePence - amount;
  db.update(vouchers).set({
    balancePence: remaining,
    status: remaining === 0 ? "redeemed" : "active",
  }).where(eq(vouchers.id, v.id)).run();

  db.insert(voucherRedemptions).values({
    voucherId: v.id,
    amountPence: amount,
    balanceAfterPence: remaining,
    branchId: opts.branchId,
    redeemedByUserId: opts.userId,
    note: opts.note?.trim() || null,
  }).run();

  return { ok: true, voucher: voucherById(v.id)!, remaining };
}

export function redemptionsFor(voucherId: number) {
  return db.select().from(voucherRedemptions)
    .where(eq(voucherRedemptions.voucherId, voucherId)).all();
}

/* ---------------- the complimentary "thank you" voucher ---------------- */

/**
 * Issued after a guest has dined — no payment, straight to active. Kept
 * separate from purchases by `origin` so the accounts can tell a sold voucher
 * from a gifted one.
 */
export async function issueThankYouVoucher(opts: {
  branchId: number;
  bookingId: number;
  name: string;
  email: string | null;
  valuePence: number;
  expiryDays: number;
}): Promise<Voucher> {
  const now = Math.floor(Date.now() / 1000);
  return db.insert(vouchers).values({
    code: uniqueCode(),
    valuePence: opts.valuePence,
    balancePence: opts.valuePence,
    status: "active",
    purchaserName: "Varanasi Restaurant",
    recipientName: opts.name,
    recipientEmail: opts.email,
    message: "With our compliments, for your next visit.",
    branchId: opts.branchId,
    origin: "thank_you",
    bookingId: opts.bookingId,
    issuedAt: now,
    expiresAt: now + opts.expiryDays * 86400,
    deliveredAt: now,
  }).returning().get();
}

export { sendWhatsApp };
