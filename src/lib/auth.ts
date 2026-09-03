import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

const COOKIE = "varanasi_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me");

export type Role = "owner" | "manager" | "staff";
export type Session = {
  userId: number; name: string; email: string; role: Role;
  branchId: number | null; mustChangePassword: boolean;
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
  redeemVoucher: ["owner", "manager", "staff"],
  issueVoucher: ["owner", "manager"],
  cancelVoucher: ["owner"],
  manageStaff: ["owner"],
  editSettings: ["owner"],
  viewAllBranches: ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export function can(session: Session, ability: keyof typeof CAN): boolean {
  return (CAN[ability] as readonly Role[]).includes(session.role);
}

/** Managers and staff are pinned to their own branch; owners may act on either. */
export function assertBranchAccess(session: Session, branchId: number): void {
  if (session.role === "owner") return;
  if (session.branchId !== branchId) throw new Error("Not permitted for this branch");
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

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as Session;
  } catch {
    return null;
  }
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
  };
}
