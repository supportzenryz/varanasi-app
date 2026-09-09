import "server-only";
import crypto from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { users, passwordResets } from "@/db/schema";
import { sendMail } from "@/lib/email";
import { bookingRules } from "@/lib/booking-config";
import { recordAnon } from "@/lib/audit";
import { passwordComplaint, BCRYPT_COST } from "@/lib/password-rules.mjs";
import bcrypt from "bcryptjs";

/**
 * "I've forgotten my password."
 *
 * Until now the only answers were "ask an owner" — no help if you are the
 * owner — and a command in a terminal on the machine holding the database. For
 * a restaurant whose staff turn over and whose owner is not a developer, that
 * is not a recovery plan; it is a phone call to us.
 *
 * The design is the boring, correct one, and each part of it is load-bearing:
 *
 *  - The link is 32 random bytes. Guessing it is not a thing that happens.
 *  - Only a SHA-256 of the token is stored. A stolen database, or a backup
 *    file read by the wrong person, contains nothing that opens an account.
 *    (No bcrypt here: the token is already high-entropy random, so there is
 *    nothing to slow a dictionary attack against — the reason to be slow with
 *    a human-chosen password does not apply.)
 *  - Thirty minutes, then it is dead. Long enough to walk to a computer.
 *  - One use. The row is marked spent before the new password is written, so a
 *    forwarded email cannot be replayed.
 *  - Asking again cancels the previous link, so only the newest email works.
 *  - The answer on screen is identical whether or not the address has an
 *    account. Otherwise the form becomes a way to find out who works here.
 *  - Every request and every use is written to the audit log, and the owner is
 *    told, because a reset nobody asked for is how an intrusion starts.
 *  - Changing the password rotates the session fingerprint, so whoever was
 *    signed in with the old password is signed out everywhere. That is the
 *    point of a reset: if someone else had the password, they lose it too.
 */

const TTL_MINUTES = 30;
/** Per address, per hour. Generous for a human, tedious for a mail-bomber. */
const MAX_PER_HOUR = 3;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const nowSec = () => Math.floor(Date.now() / 1000);

/** Spent, expired and superseded rows have no reason to accumulate. */
function tidy(): void {
  db.delete(passwordResets).where(lt(passwordResets.expiresAt, nowSec() - 86400)).run();
}

export type ResetRequest = { sent: boolean; throttled: boolean };

/**
 * Create a link and email it, if that address has an active account.
 *
 * The caller gets `sent` only so the audit log can be honest; the *screen*
 * must say the same thing either way. `throttled` likewise: the message shown
 * for it is deliberately the same sentence, because "you've asked too often"
 * confirms the address exists just as loudly as "we've sent you a link".
 */
export async function requestPasswordReset(
  email: string,
  opts: { ip?: string | null; siteUrl: string },
): Promise<ResetRequest> {
  tidy();
  const address = email.trim().toLowerCase();
  const user = db.select().from(users).where(eq(users.email, address)).get();

  if (!user || !user.isActive) {
    /* Recorded, because a run of these against addresses that do not exist is
       somebody probing for staff accounts, and that is worth being able to see
       afterwards. */
    recordAnon({
      action: "password.reset.unknown", entity: "user", entityId: address,
      detail: `no active account — from ${opts.ip ?? "unknown"}`, who: address,
    });
    return { sent: false, throttled: false };
  }

  const recent = db.select().from(passwordResets)
    .where(and(eq(passwordResets.userId, user.id), gt(passwordResets.createdAt, nowSec() - 3600)))
    .all();
  if (recent.length >= MAX_PER_HOUR) {
    recordAnon({
      action: "password.reset.throttled", entity: "user", entityId: address,
      detail: `${recent.length} requests within the hour — from ${opts.ip ?? "unknown"}`,
      who: address,
    });
    return { sent: false, throttled: true };
  }

  /* Any link already in flight stops working now. Two valid links at once
     means an old email, forwarded or left in a shared inbox, still opens the
     account after the person has taken care to request a fresh one. */
  db.update(passwordResets).set({ usedAt: nowSec() })
    .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)))
    .run();

  const token = crypto.randomBytes(32).toString("hex");
  db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: hash(token),
    expiresAt: nowSec() + TTL_MINUTES * 60,
    requestedIp: opts.ip ?? null,
  }).run();

  const link = `${opts.siteUrl.replace(/\/$/, "")}/admin/reset?token=${token}`;
  const n = bookingRules().notifications;
  await sendMail({
    to: [user.email],
    subject: "Varanasi admin — set a new password",
    fromName: n.fromName,
    fromEmail: n.fromEmail,
    replyTo: n.replyTo,
    text:
`Somebody asked to reset the password for the Varanasi admin account ${user.email}.

Open this link to choose a new one:

${link}

It works once, and only for the next ${TTL_MINUTES} minutes. After that, ask again.

If this wasn't you, you can ignore this email — your password has not changed.
Nobody can use this link but whoever has this message. If you keep receiving
these, tell the owner: it means somebody knows the address and is trying.
`,
  });

  recordAnon({
    action: "password.reset.requested", entity: "user", entityId: address,
    detail: `link sent, valid ${TTL_MINUTES} minutes — from ${opts.ip ?? "unknown"}`,
    who: address,
  });
  return { sent: true, throttled: false };
}

export type TokenCheck =
  | { ok: true; userId: number; email: string; name: string }
  | { ok: false; error: string };

/**
 * Is this link still good? Used both to render the form and, again, to accept
 * it — a token that expires while the page is open must not go through.
 */
export function checkResetToken(token: string | undefined | null): TokenCheck {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, error: "That link isn't complete. Please ask for a new one." };
  }
  const row = db.select().from(passwordResets)
    .where(eq(passwordResets.tokenHash, hash(token))).get();
  if (!row) return { ok: false, error: "That link isn't valid. Please ask for a new one." };
  if (row.usedAt) {
    return { ok: false, error: "That link has already been used. Please ask for a new one." };
  }
  if (row.expiresAt < nowSec()) {
    return { ok: false, error: `That link has expired — they last ${TTL_MINUTES} minutes. Please ask for a new one.` };
  }
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || !user.isActive) {
    return { ok: false, error: "That account is no longer active. Please speak to the owner." };
  }
  return { ok: true, userId: user.id, email: user.email, name: user.name };
}

export type ResetResult = { ok: true; email: string } | { ok: false; error: string };

/** Spend the link and set the password. */
export function resetPasswordWithToken(
  token: string,
  password: string,
  confirm: string,
  ip?: string | null,
): ResetResult {
  const check = checkResetToken(token);
  if (!check.ok) return { ok: false, error: check.error };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };

  // The same rules as everywhere else. A reset link must not be a way round
  // the password policy.
  const complaint = passwordComplaint(password, { email: check.email, name: check.name });
  if (complaint) return { ok: false, error: complaint };

  /* Spend the token first, and conditionally — `where used_at is null` — so
     two submissions of the same form set the password once. Without the
     condition, a double-tap runs the whole thing twice; harmless today, but it
     is the same shape of bug as redeeming a voucher twice, and the cost of
     writing it correctly is one clause. */
  const spent = nowSec();
  db.update(passwordResets).set({ usedAt: spent })
    .where(and(eq(passwordResets.tokenHash, hash(token)), isNull(passwordResets.usedAt)))
    .run();
  const after = db.select().from(passwordResets)
    .where(eq(passwordResets.tokenHash, hash(token))).get();
  if (!after?.usedAt || after.usedAt !== spent) {
    return { ok: false, error: "That link has just been used. Please ask for a new one." };
  }

  db.update(users).set({
    passwordHash: bcrypt.hashSync(password, BCRYPT_COST),
    mustChangePassword: false,
  }).where(eq(users.id, check.userId)).run();

  /* Notable enough for the owner to be told at once, not in tomorrow's digest:
     a password reset is both the fix for a compromised account and the first
     move of somebody taking one over. */
  recordAnon({
    action: "password.reset.used", entity: "user", entityId: check.email,
    detail: `password set from a reset link — from ${ip ?? "unknown"}. `
      + `Every session for this account has been signed out.`,
    who: check.email,
  });

  return { ok: true, email: check.email };
}
