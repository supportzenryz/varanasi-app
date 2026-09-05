import "server-only";
import crypto from "node:crypto";
import { eq, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, enquiries, vouchers } from "@/db/schema";
import { formatPence } from "@/lib/money";

/**
 * The right to erasure, UK GDPR Article 17.
 *
 * There was no way to do this. A guest writing in to ask for their details to
 * be deleted — which they are entitled to do, and which has to be answered
 * within one month — could only be served by someone opening the SQLite file
 * and editing it by hand. That is not a process, and "we did it by hand" is
 * not a defence at the point somebody asks how it was done.
 *
 * TWO DECISIONS WORTH STATING, because they are the ones that get this wrong.
 *
 * 1. Anonymise, do not delete. The rows stay; the person is taken out of them.
 *    A booking is a trading record — covers on a night, a deposit taken — and
 *    deleting it falsifies the accounts, which HMRC requires kept for six
 *    years. Article 17(3)(b) and (e) exist precisely for this: the right to
 *    erasure does not override a legal obligation to retain, and it does not
 *    override the establishment or defence of legal claims. So the personal
 *    data goes and the transaction stays.
 *
 * 2. A live gift voucher cannot be erased. A voucher with a balance is money
 *    the restaurant owes to whoever holds the code. Stripping the name from it
 *    does not cancel the debt, it just makes the debt unattributable — the
 *    restaurant still owes it and can no longer tell who to. That is worse for
 *    the customer, not better. So an erasure that would touch a live voucher
 *    is refused, with the codes named, and the owner decides: honour it, or
 *    cancel it (which is a real financial decision and already an owner-only
 *    action), and then erase.
 *
 * WHAT THIS CANNOT REACH, stated because a promise that quietly under-delivers
 * is the thing that turns a complaint into a fine:
 *
 *   - backups taken before today. They hold the data as it was. They are
 *     pruned on a rolling basis (BACKUP_KEEP, 30 by default), so the data
 *     ages out on its own. ICO guidance accepts this, provided the data is
 *     not restored into live use — and if a backup ever is restored, this
 *     erasure has to be run again.
 *   - emails already sent. A confirmation in the guest's own inbox, and the
 *     copy in the restaurant's, are outside this database.
 *
 * Both are said on screen, not just here.
 */

/** Matches an email address to a past erasure without storing the address.
 *  The audit trail has to show that a request was answered, and must not
 *  become the place the erased data lives on. */
export function requestFingerprint(identifier: string): string {
  return crypto.createHash("sha256")
    .update(identifier.trim().toLowerCase())
    .digest("hex").slice(0, 12);
}

export const ERASED_NAME = "[erased at the person's request]";

export type Found = {
  enquiries: { id: number; type: string; name: string; email: string | null; phone: string | null; createdAt: number; erased: boolean }[];
  bookings: { id: number; reference: string; guestName: string; email: string | null; phone: string | null; date: string; status: string; erased: boolean }[];
  vouchers: { id: number; code: string; status: string; balancePence: number; who: string; live: boolean }[];
};

/**
 * Everything held about one person, found the way a request arrives: an email
 * address, a phone number, or a name. Deliberately broad — a guest who booked
 * with one address and enquired with another is one person, and missing half
 * their records answers the request only halfway.
 */
export function findPersonalData(rawQuery: string): Found {
  const q = rawQuery.trim();
  if (q.length < 3) return { enquiries: [], bookings: [], vouchers: [] };
  const term = `%${q.toLowerCase()}%`;
  const digitsOnly = q.replace(/\D+/g, "");

  /* Phone numbers are stored the way the guest typed them, so "07700 900123",
     "07700900123" and "(07700) 900-123" are the same person and none of them
     matches the others as text. Strip the punctuation from both sides. */
  const phoneMatch = (column: "phone") =>
    digitsOnly.length >= 6
      ? like(
          sql`replace(replace(replace(replace(coalesce(${sql.identifier(column)},''),' ',''),'-',''),'(',''),')','')`,
          `%${digitsOnly}%`,
        )
      : undefined;

  const e = db.select().from(enquiries).where(or(
    like(sql`lower(${enquiries.name})`, term),
    like(sql`lower(coalesce(${enquiries.email},''))`, term),
    phoneMatch("phone"),
  )).all();

  const b = db.select().from(bookings).where(or(
    like(sql`lower(${bookings.guestName})`, term),
    like(sql`lower(coalesce(${bookings.email},''))`, term),
    phoneMatch("phone"),
  )).all();

  const v = db.select().from(vouchers).where(or(
    like(sql`lower(coalesce(${vouchers.recipientName},''))`, term),
    like(sql`lower(coalesce(${vouchers.recipientEmail},''))`, term),
    like(sql`lower(coalesce(${vouchers.purchaserName},''))`, term),
    like(sql`lower(coalesce(${vouchers.purchaserEmail},''))`, term),
  )).all();

  return {
    enquiries: e.map((r) => ({
      id: r.id, type: r.type, name: r.name, email: r.email, phone: r.phone,
      createdAt: r.createdAt, erased: r.name === ERASED_NAME,
    })),
    bookings: b.map((r) => ({
      id: r.id, reference: r.reference, guestName: r.guestName, email: r.email, phone: r.phone,
      date: r.date, status: r.status, erased: r.guestName === ERASED_NAME,
    })),
    vouchers: v.map((r) => ({
      id: r.id, code: r.code, status: r.status, balancePence: r.balancePence,
      who: r.recipientName ?? r.purchaserName ?? "—",
      live: r.status === "active" && r.balancePence > 0,
    })),
  };
}

export type EraseResult =
  | { ok: true; enquiries: number; bookings: number; vouchers: number; summary: string }
  | { ok: false; error: string };

/**
 * Take the person out of every record found, leaving the records.
 *
 * Allergens go with the rest and are worth calling out: dietary and allergy
 * notes are health data, special category under Article 9, and the single most
 * sensitive thing a restaurant holds about anyone.
 */
export function erasePersonalData(rawQuery: string): EraseResult {
  const found = findPersonalData(rawQuery);
  const total = found.enquiries.length + found.bookings.length + found.vouchers.length;
  if (!total) return { ok: false, error: "Nothing found for that name, email address or phone number." };

  const live = found.vouchers.filter((v) => v.live);
  if (live.length) {
    return {
      ok: false,
      error:
        `This person holds ${live.length} gift voucher${live.length === 1 ? "" : "s"} still worth ` +
        `${formatPence(live.reduce((s, v) => s + v.balancePence, 0))} (${live.map((v) => v.code).join(", ")}). ` +
        `Erasing the name would leave the restaurant owing money it can no longer attribute to anyone. ` +
        `Settle or cancel ${live.length === 1 ? "it" : "them"} first, then erase.`,
    };
  }

  let ec = 0, bc = 0, vc = 0;

  for (const r of found.enquiries) {
    if (r.erased) continue;
    db.update(enquiries).set({
      name: ERASED_NAME, email: null, phone: null, company: null,
      occasion: null, dietary: null, message: null, internalNote: null,
      marketingConsent: false,
    }).where(eq(enquiries.id, r.id)).run();
    ec++;
  }

  for (const r of found.bookings) {
    if (r.erased) continue;
    db.update(bookings).set({
      guestName: ERASED_NAME, email: null, phone: null,
      occasion: null, dietary: null, notes: null,
      marketingConsent: false, whatsappOptIn: false,
      // The self-service link in their confirmation email must stop working.
      cancelToken: null,
    }).where(eq(bookings.id, r.id)).run();
    bc++;
  }

  /* Spent, expired and cancelled vouchers only — the live ones were refused
     above. The code and the amount stay, because that is the accounting record
     of a sale; the people on it go. */
  for (const r of found.vouchers) {
    db.update(vouchers).set({
      purchaserName: null, purchaserEmail: null,
      recipientName: null, recipientEmail: null,
      message: null,
    }).where(eq(vouchers.id, r.id)).run();
    vc++;
  }

  return {
    ok: true, enquiries: ec, bookings: bc, vouchers: vc,
    summary: [
      ec ? `${ec} enquir${ec === 1 ? "y" : "ies"}` : null,
      bc ? `${bc} booking${bc === 1 ? "" : "s"}` : null,
      vc ? `${vc} voucher record${vc === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(", ") || "nothing that wasn't already erased",
  };
}
