import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, marketingContacts, branches } from "@/db/schema";
import { recordGuest } from "@/lib/audit";

/**
 * The marketing list, and the weekly email that goes to it.
 *
 * TWO DECISIONS UNDERPIN ALL OF THIS, and both were made deliberately.
 *
 * 1. THE OLD LIST IS NOT IMPORTED. There is a 4,826-row export from the
 *    previous operator carrying a marketing opt-in column, and it is not
 *    touched by anything here — there is no import path, on purpose, so it
 *    cannot happen by accident later. Consent under PECR is given to a named
 *    sender for a stated purpose; it does not transfer with a customer list
 *    when a restaurant changes supplier, and emailing 4,826 people who have
 *    never heard of this system is the ordinary way a business collects an ICO
 *    complaint. The list here starts empty and grows from people who ticked a
 *    box on this site, which is a list the restaurant can actually defend.
 *
 * 2. NOTHING SENDS ITSELF. A draft is prepared every Monday and waits. An
 *    owner opens it, edits it, and presses send. An unreviewed email to the
 *    whole list is a mistake that cannot be recalled — a wrong price or a
 *    closed date reaches everyone at once — and the cost of the review step is
 *    two minutes a week.
 *
 * The contact rows are never deleted. Unsubscribing stamps `unsubscribedAt`,
 * so somebody who asks to be left alone and then books another table is not
 * quietly added back.
 */

export type Contact = typeof marketingContacts.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;

const nowSec = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------- the list -- */

/**
 * Record that somebody agreed to hear from the restaurant.
 *
 * Called from the booking, enquiry and voucher paths at the moment the box is
 * ticked. Idempotent, and — the important part — it will not re-subscribe
 * anyone who has previously unsubscribed. A guest who opted out in March and
 * books a table in June has not changed their mind by booking a table.
 */
export function recordConsent(input: {
  email: string;
  name?: string | null;
  branchId?: number | null;
  source: "booking" | "enquiry" | "voucher" | "manual";
  /** The exact sentence shown beside the tickbox, stored verbatim. */
  consentText?: string | null;
  ip?: string | null;
}): { added: boolean; reason?: string } {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { added: false, reason: "not an email address" };

  const existing = db.select().from(marketingContacts)
    .where(eq(marketingContacts.email, email)).get();

  if (existing) {
    if (existing.unsubscribedAt) {
      return { added: false, reason: "this address has unsubscribed" };
    }
    /* Already on the list. Refresh the name and branch — people move
       restaurants and get married — but never the consent timestamp, which is
       the evidence of when they first agreed. */
    db.update(marketingContacts).set({
      name: input.name?.trim() || existing.name,
      branchId: input.branchId ?? existing.branchId,
    }).where(eq(marketingContacts.id, existing.id)).run();
    return { added: false, reason: "already subscribed" };
  }

  db.insert(marketingContacts).values({
    email,
    name: input.name?.trim() || null,
    branchId: input.branchId ?? null,
    source: input.source,
    consentText: input.consentText ?? null,
    consentedAt: nowSec(),
    consentIp: input.ip ?? null,
    unsubscribeToken: crypto.randomBytes(24).toString("base64url"),
  }).run();

  recordGuest({
    action: "marketing.consent",
    entity: "contact",
    entityId: email,
    by: input.name ?? email,
    detail: `agreed to marketing on the ${input.source} form`,
  });
  return { added: true };
}

/** Take somebody off the list. Never deletes the row — see the note above. */
export function unsubscribeByToken(token: string): { ok: boolean; email?: string } {
  const row = db.select().from(marketingContacts)
    .where(eq(marketingContacts.unsubscribeToken, token)).get();
  if (!row) return { ok: false };

  if (!row.unsubscribedAt) {
    db.update(marketingContacts).set({ unsubscribedAt: nowSec() })
      .where(eq(marketingContacts.id, row.id)).run();
    recordGuest({
      action: "marketing.unsubscribe",
      entity: "contact",
      entityId: row.email,
      by: row.name ?? row.email,
      detail: "unsubscribed from the link in an email",
    });
  }
  /* Pressing the link twice is a success, not an error. The second press is
     usually somebody checking it worked. */
  return { ok: true, email: row.email };
}

/** Everybody who should receive a campaign, optionally for one restaurant. */
export function audience(branchId?: number | null): Contact[] {
  const where = branchId
    ? and(isNull(marketingContacts.unsubscribedAt), eq(marketingContacts.branchId, branchId))
    : isNull(marketingContacts.unsubscribedAt);
  return db.select().from(marketingContacts).where(where)
    .orderBy(desc(marketingContacts.consentedAt)).all();
}

/**
 * How many people a campaign would reach.
 *
 * The admin screen called `audience(branchId).length` — which selects every
 * column of every subscriber, including the consent text and the unsubscribe
 * token, and sorts them, to produce one integer. `marketing_contacts` is the
 * fastest-growing table in the schema and rows are never deleted from it, so
 * that was a full materialise-and-sort of the entire list on every page load.
 */
export function audienceSize(branchId?: number | null): number {
  const where = branchId
    ? and(isNull(marketingContacts.unsubscribedAt), eq(marketingContacts.branchId, branchId))
    : isNull(marketingContacts.unsubscribedAt);
  return db.select({ n: sql<number>`count(*)` }).from(marketingContacts)
    .where(where).get()?.n ?? 0;
}

export function listCounts(): { subscribed: number; unsubscribed: number; thisMonth: number } {
  const monthAgo = nowSec() - 30 * 86400;
  const count = (w: ReturnType<typeof isNull> | undefined) =>
    db.select({ n: sql<number>`count(*)` }).from(marketingContacts)
      .where(w as never).get()?.n ?? 0;
  return {
    subscribed: count(isNull(marketingContacts.unsubscribedAt)),
    unsubscribed: db.select({ n: sql<number>`count(*)` }).from(marketingContacts)
      .where(sql`${marketingContacts.unsubscribedAt} is not null`).get()?.n ?? 0,
    thisMonth: db.select({ n: sql<number>`count(*)` }).from(marketingContacts)
      .where(sql`${marketingContacts.consentedAt} > ${monthAgo}`).get()?.n ?? 0,
  };
}

/* --------------------------------------------------------- the campaign -- */

/** The Monday of the week a date falls in, as YYYY-MM-DD. */
export function weekOf(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (date.getUTCDay() + 6) % 7;          // Monday = 0
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

export function campaignById(id: number): Campaign | undefined {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).get();
}

export function recentCampaigns(limit = 20): Campaign[] {
  return db.select().from(campaigns).orderBy(desc(campaigns.id)).limit(limit).all();
}

/** The draft waiting for someone to look at it, if there is one. */
export function pendingDraft(): Campaign | undefined {
  return db.select().from(campaigns).where(eq(campaigns.status, "draft"))
    .orderBy(desc(campaigns.id)).limit(1).get();
}

export function branchName(id: number | null): string {
  if (!id) return "Both restaurants";
  return db.select({ name: branches.name }).from(branches).where(eq(branches.id, id)).get()?.name
    ?? "Both restaurants";
}
