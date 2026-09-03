"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, auditLog } from "@/db/schema";
import { requireAbility, type Session, type Role } from "@/lib/auth";
import { STARTING_STAFF_PASSWORD } from "@/lib/staff";

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity: "user", entityId, detail: detail ?? null,
  }).run();
}

const ROLES: Role[] = ["owner", "manager", "staff"];
/** Also stated on the staff screen, which imports it from lib, not from here. */
const STARTING_PASSWORD = STARTING_STAFF_PASSWORD;

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function addStaff(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const email = clean(formData.get("email"))?.toLowerCase();
  const name = clean(formData.get("name"));
  const role = String(formData.get("role") ?? "staff") as Role;
  const branchRaw = String(formData.get("branchId") ?? "");

  if (!email || !name || !ROLES.includes(role)) return;
  if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    revalidatePath("/admin/staff");
    return;
  }

  // A new account starts on the shared password and must change it at first
  // login — the gate that `requireAbility` enforces, so it can't be skipped.
  const created = db.insert(users).values({
    email, name, role,
    branchId: role === "owner" ? null : (branchRaw ? Number(branchRaw) : null),
    passwordHash: bcrypt.hashSync(STARTING_PASSWORD, 10),
    isActive: true,
    mustChangePassword: true,
  }).returning({ id: users.id }).get();

  log(session, "user.create", String(created.id), `${email} as ${role}`);
  revalidatePath("/admin/staff");
}

export async function updateStaff(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const id = Number(formData.get("id"));
  const role = String(formData.get("role") ?? "") as Role;
  const branchRaw = String(formData.get("branchId") ?? "");
  const name = clean(formData.get("name"));
  if (!ROLES.includes(role) || !name) return;

  // Never let the last owner demote themselves — that locks everyone out of
  // staff management and settings permanently.
  if (role !== "owner") {
    const owners = db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).all();
    const target = db.select({ role: users.role }).from(users).where(eq(users.id, id)).get();
    if (target?.role === "owner" && owners.length <= 1) return;
  }

  db.update(users).set({
    name, role,
    branchId: role === "owner" ? null : (branchRaw ? Number(branchRaw) : null),
  }).where(eq(users.id, id)).run();

  log(session, "user.update", String(id), `${name} as ${role}`);
  revalidatePath("/admin/staff");
}

export async function toggleStaff(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const id = Number(formData.get("id"));
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return;

  // Deactivating yourself, or the last active owner, would lock the door from
  // the inside.
  if (row.id === session.userId) return;
  if (row.role === "owner" && row.isActive) {
    const activeOwners = db.select({ id: users.id }).from(users)
      .where(eq(users.role, "owner")).all().filter((u) => u.id !== id);
    if (activeOwners.length === 0) return;
  }

  db.update(users).set({ isActive: !row.isActive }).where(eq(users.id, id)).run();
  log(session, "user.toggle", String(id), row.isActive ? "deactivated" : "reactivated");
  revalidatePath("/admin/staff");
}

/** Puts an account back on the starting password with the change forced again. */
export async function resetStaffPassword(formData: FormData) {
  const session = await requireAbility("manageStaff");
  const id = Number(formData.get("id"));
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) return;

  db.update(users).set({
    passwordHash: bcrypt.hashSync(STARTING_PASSWORD, 10),
    mustChangePassword: true,
  }).where(eq(users.id, id)).run();

  log(session, "user.reset", String(id), row.email);
  revalidatePath("/admin/staff");
}

