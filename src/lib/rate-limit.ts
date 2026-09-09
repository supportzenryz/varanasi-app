import "server-only";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * "How many times has this been tried lately?" — in the database, so the
 * answer survives a deploy and is shared by every instance.
 *
 * This replaces a `Map` that lived in one server process. Two things were
 * wrong with that, and both only show up when it matters. A deploy forgot
 * every counter, so anyone locked out of the sign-in form simply waited for
 * the next release. And a second instance would have counted separately, so
 * the effective limit was the configured one multiplied by however many
 * instances happened to be running.
 *
 * It also could not be used anywhere else, which is why the public forms had
 * no limit at all: the enquiry form sends an email on every submission, so a
 * loop in a browser console was a way to empty the restaurant's monthly email
 * quota and bury the one real enquiry in three thousand fakes.
 *
 * Deliberately simple. A fixed window, one row per key, no sliding average, no
 * Redis. The attacks this stops are crude — thousands of attempts an hour from
 * a script — and a defence that is easy to reason about and cannot fall over
 * is worth more here than one that is precise at the boundary.
 */

export type Limit = {
  /** attempts allowed inside the window */
  max: number;
  /** how long the window is */
  windowSeconds: number;
  /** how long the lock lasts once the limit is crossed; defaults to the window */
  blockSeconds?: number;
  /**
   * Lock as soon as the count *reaches* max, rather than on the attempt after.
   *
   * The difference is one attempt, and which one you want depends on what is
   * being counted. For "how many of these may you do per hour" — enquiries,
   * reset emails — `max: 5` should mean five go through, so the sixth is the
   * one refused. For a failure counter, `LOGIN_MAX_PER_EMAIL = 5` is read by
   * everyone, including this repository's own comments, as "five wrong
   * passwords and the account is locked", and locking on the sixth attempt
   * would quietly give an attacker an extra guess per window.
   */
  lockOnReach?: boolean;
};

export type Verdict = {
  allowed: boolean;
  /** seconds until it may be tried again — 0 when allowed */
  retryAfter: number;
};

const nowSec = () => Math.floor(Date.now() / 1000);

/** Rows nobody will look at again. Cheap, and keeps the table from being a
 *  permanent record of every visitor's address. */
function tidy(): void {
  db.delete(rateLimits).where(lt(rateLimits.windowStart, nowSec() - 86400)).run();
}

/** Is this key locked right now? Asks without counting an attempt. */
export function isLimited(key: string): Verdict {
  const row = db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
  if (!row?.blockedUntil) return { allowed: true, retryAfter: 0 };
  const left = row.blockedUntil - nowSec();
  return left > 0 ? { allowed: false, retryAfter: left } : { allowed: true, retryAfter: 0 };
}

/**
 * Count one attempt against this key and say whether it may proceed.
 *
 * Call it *before* doing the expensive or side-effecting thing. The attempt
 * counts either way — that is the point of a limit on attempts rather than on
 * successes: an attacker learns nothing by making requests that fail.
 */
export function hit(key: string, limit: Limit): Verdict {
  const now = nowSec();
  const blocked = isLimited(key);
  if (!blocked.allowed) return blocked;

  const row = db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
  const blockFor = limit.blockSeconds ?? limit.windowSeconds;

  /* A row older than the window is not a smaller count — it is a fresh start.
     Reading it as "count so far" is how a limit of five, checked once a day,
     turns into a permanent lockout. */
  const fresh = !row || now - row.windowStart >= limit.windowSeconds;
  const windowStart = fresh ? now : row!.windowStart;
  const count = (fresh ? 0 : row!.count) + 1;

  /* `>` by default: `max: 5` means five attempts are allowed and the sixth is
     refused. `lockOnReach` flips it for failure counters — see the option. */
  const refused = limit.lockOnReach ? count >= limit.max : count > limit.max;

  db.insert(rateLimits)
    .values({ key, count, windowStart, blockedUntil: refused ? now + blockFor : null })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count, windowStart, blockedUntil: refused ? now + blockFor : null },
    })
    .run();

  if (fresh && Math.random() < 0.02) tidy();   // occasionally, not every request

  return refused
    ? { allowed: false, retryAfter: blockFor }
    : { allowed: true, retryAfter: 0 };
}

/**
 * The attempt succeeded, so forget the failures.
 *
 * Someone who mistypes their password four times and then gets it right is not
 * an attacker, and should not be four-fifths of the way to a lockout for the
 * next quarter of an hour.
 */
export function clearLimit(key: string): void {
  db.delete(rateLimits).where(eq(rateLimits.key, key)).run();
}

/** Exported for the tests, which must not inherit counters between cases. */
export function resetAllLimits(): void {
  db.delete(rateLimits).run();
}
