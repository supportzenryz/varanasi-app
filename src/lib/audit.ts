import "server-only";
import { desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, settings, users } from "@/db/schema";
import { sendMail } from "@/lib/email";
import { bookingRules } from "@/lib/booking-config";
import type { Session } from "@/lib/auth";

/**
 * Everything staff do in the admin, written down and reported to the owner.
 *
 * The audit table already existed and was already written to from eleven
 * near-identical private `log()` helpers, one per screen. Nothing ever read it.
 * There was no viewer, no export, and nobody was told anything — so a price
 * changed, a voucher was cancelled, a staff account was promoted to owner, and
 * the only evidence was a row in a table with no user interface.
 *
 * WHY NOT EMAIL EVERY ROW. A busy Saturday produces hundreds of these: every
 * booking status flip, every dish reordered. An inbox that receives four
 * hundred mails a day is an inbox nobody reads, and "the owner is told about
 * everything" then becomes false in practice while looking true on paper. So:
 *
 *   Straight away  — the things that move money, change who can do what, or
 *                    take data out of the building. These are rare and each one
 *                    is worth an interruption.
 *   Daily digest   — everything else, in one message, with nothing left out.
 *
 * Both paths draw from the same table, and the digest is driven by a cursor
 * (the id of the last row reported) rather than a flag on the row, so no
 * migration is needed and a digest that fails to send is simply re-sent next
 * time rather than silently skipped.
 */

/** Actions that interrupt the owner the moment they happen. Matched by prefix,
 *  so "voucher.cancel" covers itself and anything added under it later. */
const IMMEDIATE = [
  "user.",            // staff created, role changed, deactivated, password reset
  "settings.",        // deposit policy, slot times, notification addresses
  "voucher.cancel",   // wipes a live balance the restaurant owes someone
  "voucher.issue",    // mints liability with no payment behind it
  "backup.download",  // the whole customer database leaves in a file
  "enquiry.export",   // bulk personal data leaves in a file
  "gdpr.erase",       // a person erased under Article 17 — irreversible
  "booking.refund",   // money leaving the account
  "login.locked",     // repeated failures against one account or from one address
] as const;

const DIGEST_KEY = "audit_digest_cursor";
const DIGEST_HOURS = Number(process.env.AUDIT_DIGEST_HOURS ?? 24);

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: string | null;
};

/** Who hears about it. OWNER_EMAIL wins so the address can be set without
 *  touching the database; otherwise every active owner account, and failing
 *  that whatever the reservations notifications are set to. */
export function ownerRecipients(): string[] {
  const env = (process.env.OWNER_EMAIL ?? "")
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;

  const owners = db.select({ email: users.email }).from(users)
    .where(eq(users.role, "owner")).all()
    .map((u) => u.email).filter(Boolean);
  if (owners.length) return owners;

  try {
    return bookingRules().notifications.to.filter(Boolean);
  } catch {
    return [];
  }
}

function isImmediate(action: string): boolean {
  return IMMEDIATE.some((p) => action === p || action.startsWith(p));
}

function stamp(at: number): string {
  return new Date(at * 1000).toLocaleString("en-GB", {
    timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
  });
}

/**
 * Write one entry, and tell the owner if it is one of the loud ones.
 *
 * Never throws. An audit failure must not take down the action it is recording
 * — a manager should not be unable to change a price because the mail provider
 * is down — but it must be visible in the container log, because a silent
 * audit trail is worse than none.
 */
export function record(session: Session, entry: AuditEntry): void {
  let id: number | null = null;
  try {
    db.insert(auditLog).values({
      userId: session.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
    }).run();
    id = db.select({ id: auditLog.id }).from(auditLog)
      .orderBy(desc(auditLog.id)).limit(1).get()?.id ?? null;
  } catch (err) {
    console.error("[audit] could not write entry:", err instanceof Error ? err.message : err);
    return;
  }

  if (!isImmediate(entry.action)) return;

  // Deliberately not awaited: the guest or the member of staff is waiting on
  // the redirect, and an email provider taking four seconds must not be four
  // seconds of a blank button.
  void notifyOwner(session, entry).catch((err) =>
    console.error("[audit] alert failed:", err instanceof Error ? err.message : err));
  void id;
}

async function notifyOwner(session: Session, entry: AuditEntry): Promise<void> {
  const to = ownerRecipients();
  if (!to.length) {
    console.warn(`[audit] no owner address for "${entry.action}" — set OWNER_EMAIL`);
    return;
  }

  const lines = [
    `${entry.action} — by ${session.name} (${session.email}, ${session.role})`,
    "",
    `When:   ${stamp(Math.floor(Date.now() / 1000))}`,
    `What:   ${entry.entity}${entry.entityId ? ` ${entry.entityId}` : ""}`,
    entry.detail ? `Detail: ${entry.detail}` : null,
    "",
    "This is one of the changes the admin reports immediately: money, access,",
    "or personal data leaving the building. Everything else arrives in the",
    "daily summary.",
    "",
    "If this was not expected, open Admin → Activity log, and Admin → Staff to",
    "deactivate the account.",
  ].filter(Boolean);

  await sendMail({
    to,
    ...sender(),
    subject: `Varanasi admin: ${entry.action} by ${session.name}`,
    text: lines.join("\n"),
  });
}

/**
 * The same, for events with no signed-in user behind them — a failed sign-in,
 * a lockout, anything the scheduler does. `userId` is nullable in the table
 * precisely for this.
 */
export function recordAnon(entry: AuditEntry & { who?: string }): void {
  try {
    db.insert(auditLog).values({
      userId: null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
    }).run();
  } catch (err) {
    console.error("[audit] could not write entry:", err instanceof Error ? err.message : err);
    return;
  }
  if (!isImmediate(entry.action)) return;

  const to = ownerRecipients();
  if (!to.length) return;
  void sendMail({
    to,
    ...sender(),
    subject: `Varanasi admin: ${entry.action}`,
    text: [
      entry.action,
      "",
      `When:   ${stamp(Math.floor(Date.now() / 1000))}`,
      `What:   ${entry.entity}${entry.entityId ? ` ${entry.entityId}` : ""}`,
      entry.detail ? `Detail: ${entry.detail}` : null,
      entry.who ? `Who:    ${entry.who}` : null,
      "",
      "Nobody was signed in when this happened.",
    ].filter(Boolean).join("\n"),
  }).catch((err) => console.error("[audit] alert failed:", err instanceof Error ? err.message : err));
}

/* ---------------------------------------------------------------- digest -- */

/**
 * The address these alerts are sent from.
 *
 * Every message in this file used to omit it, so they fell through to the
 * built-in default while booking confirmations used the address configured in
 * Admin → Settings. Changing that setting therefore fixed the guest's email and
 * silently left the owner's alerts on the old address — visible in one log as
 * two different senders being refused for two different reasons in the same
 * minute. One setting should mean one sender.
 */
function sender() {
  const n = bookingRules().notifications;
  return { fromName: n.fromName, fromEmail: n.fromEmail, replyTo: n.replyTo };
}

function cursor(): number {
  const row = db.select().from(settings).where(eq(settings.key, DIGEST_KEY)).get();
  const n = Number(row?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function setCursor(id: number): void {
  db.insert(settings).values({ key: DIGEST_KEY, value: String(id), updatedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(id), updatedAt: Math.floor(Date.now() / 1000) },
    }).run();
}

const LAST_SENT_KEY = "audit_digest_sent_at";

function digestDue(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, LAST_SENT_KEY)).get();
  const last = Number(row?.value ?? 0);
  if (!last) return true;

  // After a refusal, wait out the backoff rather than the usual interval.
  const failures = readNumber(FAILURES_KEY);
  const waitHours = failures > 0 ? Math.max(DIGEST_HOURS, backoffHours(failures)) : DIGEST_HOURS;
  return Date.now() / 1000 - last >= waitHours * 3600;
}

function markDigestSent(): void {
  const at = String(Math.floor(Date.now() / 1000));
  db.insert(settings).values({ key: LAST_SENT_KEY, value: at, updatedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoUpdate({ target: settings.key, set: { value: at, updatedAt: Math.floor(Date.now() / 1000) } })
    .run();
}

/**
 * How many times in a row the digest has failed to send, and when to try next.
 *
 * A refused send used to log "will retry next hour" and mean it, for ever. When
 * the refusal is a configuration fault rather than a hiccup — an unverified
 * sending domain, say — that is not a retry, it is the same doomed request once
 * an hour until somebody notices, and a log filled with identical lines that
 * never said *why*. Seven of them in one paste is what prompted this.
 *
 * So the interval doubles: an hour, two, four, up to a day. A genuine outage is
 * still picked up quickly, a misconfiguration stops shouting, and either way it
 * recovers on its own the moment sending starts working — nobody has to
 * remember to restart anything.
 */
const FAILURES_KEY = "audit_digest_failures";
const MAX_BACKOFF_HOURS = 24;

function readNumber(key: string): number {
  const n = Number(db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function writeNumber(key: string, value: number): void {
  const now = Math.floor(Date.now() / 1000);
  db.insert(settings).values({ key, value: String(value), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(value), updatedAt: now } }).run();
}

/** Hours to wait after `n` consecutive failures: 1, 2, 4, 8, 16, then 24. */
function backoffHours(n: number): number {
  return Math.min(2 ** Math.max(0, n - 1), MAX_BACKOFF_HOURS);
}

/**
 * One message covering every admin change since the last one.
 *
 * Called hourly from the scheduler; sends only when the interval has elapsed
 * and there is something to say. The cursor moves only after the send succeeds,
 * so a provider outage delays the report rather than losing a day of it.
 */
export async function sendAuditDigest(force = false): Promise<number> {
  if (!force && !digestDue()) return 0;

  /* First run on an existing database. The cursor starts at zero, which would
     make the first summary the entire history — on this deployment, 143
     entries going back to the first seed. That is noise, not news, and the
     whole history is on the Activity log screen anyway. Start the clock here
     and report from the next change onwards. */
  const started = db.select().from(settings).where(eq(settings.key, LAST_SENT_KEY)).get();
  if (!started) {
    const newest = db.select({ id: auditLog.id }).from(auditLog)
      .orderBy(desc(auditLog.id)).limit(1).get()?.id ?? 0;
    setCursor(newest);
    markDigestSent();
    console.log(`[audit] daily summary armed at entry ${newest}; reporting from the next change on`);
    return 0;
  }

  const since = cursor();
  const rows = db.select({
    id: auditLog.id, action: auditLog.action, entity: auditLog.entity,
    entityId: auditLog.entityId, detail: auditLog.detail, createdAt: auditLog.createdAt,
    userId: auditLog.userId,
  }).from(auditLog).where(gt(auditLog.id, since)).orderBy(auditLog.id).all();

  if (!rows.length) {
    if (force) console.log("[audit] digest: nothing to report");
    markDigestSent();
    return 0;
  }

  const to = ownerRecipients();
  if (!to.length) {
    console.warn("[audit] digest has nowhere to go — set OWNER_EMAIL");
    return 0;
  }

  const staff = new Map(
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).all()
      .map((u) => [u.id, u]),
  );

  const byWho = new Map<string, typeof rows>();
  for (const r of rows) {
    const u = r.userId != null ? staff.get(r.userId) : undefined;
    const who = u ? `${u.name} (${u.email})` : "system";
    const list = byWho.get(who) ?? [];
    list.push(r);
    byWho.set(who, list);
  }

  const body: string[] = [
    `${rows.length} change${rows.length === 1 ? "" : "s"} in the Varanasi admin.`,
    "",
    `Covering everything up to ${stamp(Math.floor(Date.now() / 1000))}.`,
    "",
  ];
  for (const [who, list] of byWho) {
    body.push(`${who} — ${list.length} change${list.length === 1 ? "" : "s"}`);
    for (const r of list) {
      body.push(
        `  ${stamp(r.createdAt)}  ${r.action}` +
          `${r.entityId ? ` [${r.entityId}]` : ""}${r.detail ? ` — ${r.detail}` : ""}`,
      );
    }
    body.push("");
  }
  body.push("The full history, searchable, is at Admin → Activity log.");

  const res = await sendMail({
    to,
    ...sender(),
    subject: `Varanasi admin summary — ${rows.length} change${rows.length === 1 ? "" : "s"}`,
    text: body.join("\n"),
  });

  if (!res.ok) {
    /* Say why, and say when. "will retry next hour" told nobody anything and
       was not even true after the first hour — it repeated for ever. The
       provider's own words are in `res.detail`, and they are usually explicit
       about what is wrong. */
    const failures = readNumber(FAILURES_KEY) + 1;
    writeNumber(FAILURES_KEY, failures);
    // Restart the clock so the backoff is measured from this attempt, not from
    // the last success, which may be days ago.
    markDigestSent();
    const next = backoffHours(failures);
    console.error(
      `[audit] digest refused (attempt ${failures}): ${res.detail ?? "no reason given"}`,
    );
    console.error(`[audit] next attempt in ${next} hour${next === 1 ? "" : "s"}. `
      + "The entries are safe — the cursor has not moved, so nothing is skipped when it works.");
    return 0;
  }

  if (readNumber(FAILURES_KEY) > 0) {
    writeNumber(FAILURES_KEY, 0);
    console.log("[audit] digest sending again after earlier refusals");
  }
  setCursor(rows[rows.length - 1].id);
  markDigestSent();
  console.log(`[audit] digest sent: ${rows.length} entries -> ${to.join(", ")}`);
  return rows.length;
}
