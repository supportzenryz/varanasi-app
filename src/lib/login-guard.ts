import "server-only";

/**
 * Slowing down a password-guessing attack on /admin/login.
 *
 * There was nothing here at all: the form accepted attempts as fast as they
 * could be sent, against email addresses that appear on the restaurant's own
 * website, protecting accounts that can cancel gift vouchers and download the
 * customer database. bcrypt makes each attempt cost about 100ms, which is a
 * speed bump, not a lock — a hundred thousand guesses is a long weekend.
 *
 * Two counters, because either alone is easy to walk around:
 *   by email    — stops one account being ground down from many addresses
 *   by address  — stops one attacker working through every account
 *
 * In memory rather than in the database. It is per-process and resets on
 * deploy, which is a real limitation and the honest trade: a table would need
 * a migration and a write on every failed attempt, and the attack this defends
 * against is measured in thousands of attempts per minute, all of which land
 * on the same process. If the app is ever run as more than one instance this
 * needs to move to the database — noted here so that decision is deliberate.
 */

const WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;

type Bucket = { count: number; first: number; until: number };
const byEmail = new Map<string, Bucket>();
const byIp = new Map<string, Bucket>();

function bump(map: Map<string, Bucket>, key: string, max: number): boolean {
  const now = Date.now();
  const b = map.get(key);
  if (!b || now - b.first > WINDOW_MS) {
    map.set(key, { count: 1, first: now, until: 0 });
    return false;
  }
  b.count++;
  if (b.count >= max) {
    b.until = now + WINDOW_MS;
    return true;               // just crossed the line
  }
  return false;
}

function blocked(map: Map<string, Bucket>, key: string): number {
  const b = map.get(key);
  if (!b || !b.until) return 0;
  const left = b.until - Date.now();
  if (left <= 0) {
    map.delete(key);
    return 0;
  }
  return Math.ceil(left / 60_000);
}

/** Minutes remaining, or 0 when the attempt may proceed. */
export function lockedFor(email: string, ip: string): number {
  return Math.max(blocked(byEmail, email.trim().toLowerCase()), blocked(byIp, ip));
}

/** Record a failure. Returns true the moment a lock takes effect, so the
 *  caller can report it once rather than on every subsequent attempt. */
export function noteFailure(email: string, ip: string): boolean {
  const a = bump(byEmail, email.trim().toLowerCase(), MAX_PER_EMAIL);
  const b = bump(byIp, ip, MAX_PER_IP);
  return a || b;
}

/** A correct password clears that account's counter — someone who mistypes
 *  four times and then gets it right is not an attacker. */
export function noteSuccess(email: string, ip: string): void {
  byEmail.delete(email.trim().toLowerCase());
  const b = byIp.get(ip);
  if (b) b.until = 0;
}

/** Exported for the tests, which must not inherit state between cases. */
export function resetLoginGuard(): void {
  byEmail.clear();
  byIp.clear();
}

export const LOGIN_LIMITS = { WINDOW_MS, MAX_PER_EMAIL, MAX_PER_IP };
