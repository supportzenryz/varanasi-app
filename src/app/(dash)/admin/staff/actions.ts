"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { branches, users } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, type Session, type Role } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";
import { checkEmail, checkName } from "@/lib/validate";
import { STARTING_STAFF_PASSWORD } from "@/lib/staff";

const BACK = "/admin/staff";

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "user", entityId, detail });
}

const ROLES: Role[] = ["owner", "manager", "staff"];
/** Also stated on the staff screen, which imports it from lib, not from here. */
const STARTING_PASSWORD = STARTING_STAFF_PASSWORD;

/**
 * Which restaurant an account belongs to, decided here rather than trusted
 * from the form.
 *
 * The screen offered "Both / none" for every role, and this function did not
 * exist: a manager could be saved with no branch. That is not a manager who
 * sees both restaurants — every list is scoped by branch id, so it is an
 * account that sees nothing, on a page that tells them they are seeing their
 * own branch. The rule the rest of the code already assumes, made true at the
 * point of entry: owners have no branch, everyone else must have one.
 */
function resolveBranch(role: Role, raw: string): number | null {
  if (role === "owner") return null;                 // owners are group-wide
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) problem(BACK,
    "Managers and staff have to be attached to Birmingham or Leicester — " +
    "an account with no restaurant can't see anything.");
  const exists = db.select({ id: branches.id }).from(branches).where(eq(branches.id, n)).get();
  if (!exists) problem(BACK, "That isn't a restaurant we recognise.");
  return n;
}

/** Owners who can still sign in. The old count included deactivated ones, so
 *  the "don't remove the last owner" guard could be satisfied by an owner
 *  nobody could log in as — locking the door with the key inside. */
function activeOwnersOtherThan(id: number): number {
  return db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true))).all()
    .filter((u) => u.id !== id).length;
}

export async function addStaff(formData: FormData) {
  const session = await requireAbility("manageStaff");

  const name = checkName(formData.get("name") as string);
  if (!name.ok) problem(BACK, name.error);

  const email = checkEmail(formData.get("email") as string);
  if (!email.ok) problem(BACK, email.error);

  const role = String(formData.get("role") ?? "staff") as Role;
  if (!ROLES.includes(role)) problem(BACK, "Choose owner, manager or staff.");

  const branchId = resolveBranch(role, String(formData.get("branchId") ?? ""));

  if (db.select({ id: users.id }).from(users).where(eq(users.email, email.value)).get()) {
    problem(BACK, `${email.value} already has an account. Reactivate it rather than making a second one.`);
  }

  // A new account starts on the shared password and must change it at first
  // login — the gate that `requireAbility` enforces, so it can't be skipped.
  const created = db.insert(users).values({
    email: email.value, name: name.value, role, branchId,
    passwordHash: bcrypt.hashSync(STARTING_PASSWORD, 10),
    isActive: true,
    mustChangePassword: true,
  }).returning({ id: users.id }).get();

  log(session, "user.create", String(created.id), `${email.value} as ${role}${branchId ? ` at branch ${branchId}` : ""}`);
  revalidatePath(BACK);
  ok(BACK, `${name.value} added as ${role}. They sign in with the starting password and must change it.`);
}

export async function updateStaff(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const id = Number(formData.get("id"));
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) problem(BACK, "That account no longer exists.");

  const name = checkName(formData.get("name") as string);
  if (!name.ok) problem(BACK, name.error);

  const role = String(formData.get("role") ?? "") as Role;
  if (!ROLES.includes(role)) problem(BACK, "Choose owner, manager or staff.");

  // Never let the last owner demote themselves — that locks everyone out of
  // staff management and settings permanently.
  if (role !== "owner" && row!.role === "owner" && activeOwnersOtherThan(id) === 0) {
    problem(BACK, "This is the only active owner. Make someone else an owner first, then change this account.");
  }

  const branchId = resolveBranch(role, String(formData.get("branchId") ?? ""));

  db.update(users).set({ name: name.value, role, branchId }).where(eq(users.id, id)).run();

  log(session, "user.update", String(id),
    `${name.value} as ${role}${branchId ? ` at branch ${branchId}` : ""}` +
    (row!.role !== role ? ` (was ${row!.role})` : "") +
    (row!.branchId !== branchId ? ` (was branch ${row!.branchId ?? "none"})` : ""));
  revalidatePath(BACK);
  ok(BACK, `${name.value} saved.`);
}

export async function toggleStaff(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const id = Number(formData.get("id"));
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) problem(BACK, "That account no longer exists.");

  // Deactivating yourself, or the last active owner, would lock the door from
  // the inside. Both used to `return` silently, so the switch appeared not to
  // work and nothing said why.
  if (row!.id === session.userId) {
    problem(BACK, "You can't deactivate your own account — ask another owner to do it.");
  }
  if (row!.role === "owner" && row!.isActive && activeOwnersOtherThan(id) === 0) {
    problem(BACK, "This is the only active owner. Someone has to be able to manage staff and settings.");
  }

  db.update(users).set({ isActive: !row!.isActive }).where(eq(users.id, id)).run();
  log(session, "user.toggle", String(id), row!.isActive ? "deactivated" : "reactivated");
  revalidatePath(BACK);
  ok(BACK, row!.isActive
    ? `${row!.name} deactivated — they are signed out everywhere immediately.`
    : `${row!.name} can sign in again.`);
}

/** Puts an account back on the starting password with the change forced again. */
export async function resetStaffPassword(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const id = Number(formData.get("id"));
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) problem(BACK, "That account no longer exists.");

  db.update(users).set({
    passwordHash: bcrypt.hashSync(STARTING_PASSWORD, 10),
    mustChangePassword: true,
  }).where(eq(users.id, id)).run();

  log(session, "user.reset", String(id), row!.email);
  revalidatePath(BACK);
  /* Worth stating, because it is the reason to use this button at all: the
     session cookie carries a fingerprint of the password hash, so changing the
     hash ends every session that account had. */
  ok(BACK, `${row!.name} is back on the starting password and has been signed out everywhere. ` +
    `They must set a new one when they next sign in.`);
}
