import "server-only";
import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { notices } from "@/db/schema";

/**
 * The "it saved" / "it didn't, because…" message, held server-side.
 *
 * WHY IT MOVED OUT OF THE URL. Every admin action ends in a redirect, and the
 * message used to travel in the query string:
 *
 *   /admin/vouchers?code=VG-VG2Q-HNUR-KXVC&saved=Voucher%20VG-VG2Q-HNUR-KXVC
 *   %20issued%20for%20£25%20and%20emailed%20to%20someone%40gmail.com
 *
 * Two things wrong with that, and the first is the serious one. A voucher code
 * is bearer money — whoever reads it can spend it — and a URL is written into
 * browser history on a shared restaurant terminal, into the server's access
 * log, and into any proxy in between. The second is that a guest's email
 * address is personal data and had no business being in an address bar either.
 * Neither is a public exposure — the admin is behind a password, sends
 * `no-store` and is `noindex` — but "only the people standing at the till can
 * read the voucher codes" is not a defence worth making.
 *
 * What is left in the URL is six random bytes that mean nothing on their own.
 *
 * WHY A TABLE RATHER THAN A COOKIE. A cookie was the obvious answer and it is
 * the wrong one here: `cookies()` in this version of Next is asynchronous, so
 * `ok()` and `problem()` would have to be too — and the moment they return a
 * promise instead of `never`, TypeScript stops treating them as terminal. Every
 * one of the hundred-odd
 *
 *     if (!name.ok) problem(BACK, name.error);
 *
 * lines loses the narrowing that makes the line after it safe, and the compiler
 * reported 201 errors to prove it. The database here is `node:sqlite`, which is
 * synchronous, so a table keeps the whole mechanism a plain function call and
 * the call sites untouched.
 */

export type Notice = {
  kind: "ok" | "problem";
  message: string;
  /** What the screen was looking at — see the `context` column. */
  context?: string | null;
};

/** How long a message stays readable. Long enough for a slow render, short
 *  enough that a stale one cannot resurface later in the shift. */
const TTL_SECONDS = 300;

/** Stores the message and returns the nonce to put in the redirect. */
export function stashNotice(notice: Notice): string {
  const id = crypto.randomBytes(6).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.insert(notices).values({
    id, kind: notice.kind, message: notice.message, context: notice.context ?? null,
  }).run();
  // Swept on write, so the table cannot grow without bound and nothing needs
  // to remember to tidy it.
  db.delete(notices).where(lt(notices.createdAt, now - TTL_SECONDS)).run();
  return id;
}

/**
 * The message for this render, if the nonce in the URL names one.
 *
 * Deliberately does NOT delete the row. A component can render more than once,
 * and a banner that disappears because React rendered it twice is worse than
 * one that lingers in a table nobody reads. The nonce is what makes it
 * one-shot in practice: it only appears on the URL the redirect produced.
 */
export function readNotice(id: string | undefined): Notice | null {
  if (!id) return null;
  const row = db.select().from(notices).where(eq(notices.id, id)).get();
  if (!row) return null;
  const age = Math.floor(Date.now() / 1000) - row.createdAt;
  if (age > TTL_SECONDS) return null;
  return { kind: row.kind, message: row.message, context: row.context };
}
