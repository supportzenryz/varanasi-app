import "server-only";
import { hit, isLimited, clearLimit, resetAllLimits, type Limit } from "@/lib/rate-limit";

/**
 * Slowing down a password-guessing attack on /admin/login.
 *
 * There was nothing here at all to begin with: the form accepted attempts as
 * fast as they could be sent, against email addresses that appear on the
 * restaurant's own website, protecting accounts that can cancel gift vouchers
 * and download the customer database. bcrypt makes each attempt cost about
 * 100ms, which is a speed bump, not a lock — a hundred thousand guesses is a
 * long weekend.
 *
 * Two counters, because either alone is easy to walk around:
 *   by email    — stops one account being ground down from many addresses
 *   by address  — stops one attacker working through every account
 *
 * The counters now live in the database rather than in a `Map` in the server
 * process. The old comment here was honest about that being a limitation and
 * asked for it to be revisited if the app ever ran as more than one instance;
 * the deciding argument turned out to be simpler than instances. Every deploy
 * emptied the counters, so anyone who had been locked out only had to wait for
 * the next release — and Railway redeploys on every push.
 */

/* Tunable, because the right numbers depend on the room. The per-email limit
 * is the real defence and stays tight. The per-address one is a blunt
 * instrument: every member of staff at one restaurant shares a router, so a
 * cap of 20 counts a whole shift's fumbled passwords as one attacker — and
 * the end-to-end suite, which signs in repeatedly from one address, tripped it
 * and locked the owner out of its own run. 50 still stops a machine; 20
 * stopped a busy Saturday. */
const WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES ?? 15);
const MAX_PER_EMAIL = Number(process.env.LOGIN_MAX_PER_EMAIL ?? 5);
const MAX_PER_IP = Number(process.env.LOGIN_MAX_PER_IP ?? 50);

/* `lockOnReach`, so the numbers mean what they say: five wrong passwords locks
   the account, rather than five wrong passwords plus one more for luck. */
const emailLimit: Limit = { max: MAX_PER_EMAIL, windowSeconds: WINDOW_MINUTES * 60, lockOnReach: true };
const ipLimit: Limit = { max: MAX_PER_IP, windowSeconds: WINDOW_MINUTES * 60, lockOnReach: true };

const emailKey = (email: string) => `login:email:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

/** Minutes remaining, or 0 when the attempt may proceed. */
export function lockedFor(email: string, ip: string): number {
  const worst = Math.max(
    isLimited(emailKey(email)).retryAfter,
    isLimited(ipKey(ip)).retryAfter,
  );
  return worst > 0 ? Math.ceil(worst / 60) : 0;
}

/** Record a failure. Returns true the moment a lock takes effect, so the
 *  caller can report it once rather than on every subsequent attempt. */
export function noteFailure(email: string, ip: string): boolean {
  const a = hit(emailKey(email), emailLimit);
  const b = hit(ipKey(ip), ipLimit);
  return !a.allowed || !b.allowed;
}

/** A correct password clears that account's counter — someone who mistypes
 *  four times and then gets it right is not an attacker.
 *
 *  The address counter is cleared too. It is shared by everyone in the
 *  building, so holding a successful sign-in against the next person's
 *  attempts is the wrong reading of it. */
export function noteSuccess(email: string, ip: string): void {
  clearLimit(emailKey(email));
  clearLimit(ipKey(ip));
}

/** Exported for the tests, which must not inherit state between cases. */
export function resetLoginGuard(): void {
  resetAllLimits();
}

export const LOGIN_LIMITS = {
  WINDOW_MS: WINDOW_MINUTES * 60_000,
  MAX_PER_EMAIL,
  MAX_PER_IP,
};
