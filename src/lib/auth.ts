import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, branches } from "@/db/schema";

const COOKIE = "varanasi_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me");

export type Role = "owner" | "manager" | "staff";
export type Session = {
  userId: number; name: string; email: string; role: Role;
  branchId: number | null; mustChangePassword: boolean;
  /** digest of the password hash — see fingerprint() */
  fp?: string;
};

/** What each role is allowed to do. Checked server-side on every action. */
export const CAN = {
  editMenu: ["owner", "manager"],
  editRooms: ["owner", "manager"],
  editBlockedDates: ["owner", "manager"],
  viewBookings: ["owner", "manager", "staff"],
  editBookings: ["owner", "manager"],
  viewEnquiries: ["owner", "manager", "staff"],
  editEnquiries: ["owner", "manager"],
  // Reading one guest's enquiry on screen and walking out with the entire
  // customer list as a file are different risks, and were the same permission.
  // Under UK GDPR the second is a bulk export of personal data — names,
  // phones, dietary and allergy notes — so it is not for the staff role.
  exportEnquiries: ["owner", "manager"],
  redeemVoucher: ["owner", "manager", "staff"],
  issueVoucher: ["owner", "manager"],
  cancelVoucher: ["owner"],
  manageStaff: ["owner"],
  editSettings: ["owner"],
  viewAllBranches: ["owner"],
  manageBackups: ["owner"],
  viewAuditLog: ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export function can(session: Session, ability: keyof typeof CAN): boolean {
  return (CAN[ability] as readonly Role[]).includes(session.role);
}

/** Managers and staff are pinned to their own branch; owners may act on either.
 *  A non-owner with no branch assigned matches nothing, deliberately — see
 *  visibleBranchIds below for why that is the right answer and not a bug. */
export function branchAllowed(session: Session, branchId: number): boolean {
  if (session.role === "owner") return true;
  return session.branchId != null && session.branchId === branchId;
}

/**
 * The same check, for callers that have no sensible way to carry on.
 *
 * It used to `throw`, which in a server action means Next.js renders its own
 * error page: a white screen reading "Internal Server Error", digest
 * 3f9a1c… — indistinguishable from the software being broken. A Leicester
 * manager who followed a Birmingham link concluded the admin had crashed and
 * rang about it. A redirect to a page that says what happened is both truthful
 * and recoverable.
 */
export function assertBranchAccess(session: Session, branchId: number): void {
  if (!branchAllowed(session, branchId)) redirect("/admin?denied=branch");
}

/**
 * Which restaurants this account may see. The single answer to that question.
 *
 * Every screen used to work it out for itself, with the same shape each time:
 *
 *     const scoped = session.role !== "owner" && session.branchId != null;
 *
 * which reads as "scope non-owners" and behaves as "scope non-owners who have
 * a branch". A manager or staff member with no branch set — an option the
 * staff screen offered for every role — therefore fell through to *unscoped*
 * and saw both restaurants: their overview showed the group's figures while
 * the copy still said "you're seeing your own branch", and they could spend
 * the other restaurant's gift vouchers, because the redeem guard also
 * short-circuits on a null.
 *
 * An empty list is the honest answer for that account: no branch assigned
 * means no data, not all data. Callers pass it to `inArray`, which matches
 * nothing when empty.
 */
export function visibleBranchIds(session: Session): number[] {
  if (session.role === "owner") {
    return db.select({ id: branches.id }).from(branches).all().map((b) => b.id);
  }
  return session.branchId == null ? [] : [session.branchId];
}

/** True when the account is a non-owner with nothing assigned — a misconfigured
 *  account rather than a restricted one, and worth saying so on screen. */
export function hasNoBranch(session: Session): boolean {
  return session.role !== "owner" && session.branchId == null;
}

/**
 * A short fingerprint of the stored password hash.
 *
 * Carried in the session and re-checked on every request, so changing a
 * password — whether the owner resets it or the user changes their own —
 * invalidates every session that account already had. Without it, "Reset
 * password" is not a remedy for a compromised account at all: the intruder
 * keeps working for the remaining life of their cookie.
 *
 * The hash itself never leaves the server; this is a truncated digest of it,
 * which is enough to notice that it changed and useless for anything else.
 */
function fingerprint(passwordHash: string): string {
  return crypto.createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export async function createSession(s: Session): Promise<void> {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24 * 7,
  });
}

/**
 * The session, re-checked against the database on every request.
 *
 * It used to return the token's contents verbatim. Role, branch, active state
 * and the password gate were therefore whatever they had been at sign-in,
 * frozen for the seven days the cookie lived — so deactivating an account,
 * demoting someone, moving them to another branch or resetting their password
 * changed nothing until the cookie expired. A deactivated account was observed
 * taking £5 off a customer's gift voucher.
 *
 * The cost is one primary-key lookup per request, which on a local SQLite file
 * is not a cost worth trading a week of stale authority for.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  let claim: Session & { fp?: string };
  try {
    const { payload } = await jwtVerify(token, secret);
    claim = payload as unknown as Session & { fp?: string };
  } catch {
    return null;
  }

  const row = db.select().from(users).where(eq(users.id, claim.userId)).get();
  if (!row || !row.isActive) return null;                       // gone or switched off
  if (claim.fp !== fingerprint(row.passwordHash)) return null;  // password changed since

  // The row wins over the token for everything that can be revoked.
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    branchId: row.branchId ?? null,
    mustChangePassword: row.mustChangePassword,
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  return s;
}

/**
 * `mustChangePassword` is a gate, not a banner: staff are handed a shared
 * starting password, so until it is replaced they get no further than the page
 * that replaces it. Called from `requireAbility`, which every working screen
 * goes through — the password page itself uses neither, so it can't loop.
 */
export async function requirePasswordChanged(): Promise<Session> {
  const s = await requireSession();
  if (s.mustChangePassword) redirect("/admin/password");
  return s;
}

export async function requireAbility(ability: keyof typeof CAN): Promise<Session> {
  const s = await requirePasswordChanged();
  if (!can(s, ability)) redirect("/admin?denied=1");
  return s;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function verifyLogin(email: string, password: string): Promise<Session | null> {
  const row = db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
  if (!row || !row.isActive) return null;
  if (!bcrypt.compareSync(password, row.passwordHash)) return null;
  db.update(users).set({ lastLoginAt: Math.floor(Date.now() / 1000) }).where(eq(users.id, row.id)).run();
  return {
    userId: row.id, name: row.name, email: row.email, role: row.role as Role,
    branchId: row.branchId ?? null, mustChangePassword: row.mustChangePassword,
    fp: fingerprint(row.passwordHash),
  };
}

/** Re-issues the cookie for a user whose password has just changed, so that
 *  changing your own password does not sign you out of the tab you did it in
 *  while still ending every other session that account had. */
export async function refreshSessionAfterPasswordChange(userId: number): Promise<void> {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) return;
  await createSession({
    userId: row.id, name: row.name, email: row.email, role: row.role as Role,
    branchId: row.branchId ?? null, mustChangePassword: row.mustChangePassword,
    fp: fingerprint(row.passwordHash),
  });
}
