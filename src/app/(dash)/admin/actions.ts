"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { record } from "@/lib/audit";
import { destroySession, getSession, requireSession, refreshSessionAfterPasswordChange } from "@/lib/auth";

export async function logoutAction() {
  // Read the session before it is destroyed, so the entry has a name on it.
  const session = await getSession();
  if (session) record(session, { action: "logout", entity: "user", entityId: String(session.userId) });
  await destroySession();
  redirect("/admin/login");
}

export async function changePasswordAction(_prev: { error?: string; ok?: boolean } | undefined, formData: FormData) {
  const session = await requireSession();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 10) return { error: "Use at least 10 characters." };
  if (next !== confirm) return { error: "The two new passwords don't match." };

  const row = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!row || !bcrypt.compareSync(current, row.passwordHash)) {
    return { error: "Your current password isn't right." };
  }

  db.update(users)
    .set({ passwordHash: bcrypt.hashSync(next, 10), mustChangePassword: false })
    .where(eq(users.id, session.userId)).run();
  record(session, { action: "password.change", entity: "user", entityId: String(session.userId) });

  // Re-issue from the row, not from the old session: the cookie is bound to a
  // fingerprint of the password hash, so reusing the previous session object
  // would hand back a cookie carrying the fingerprint that just stopped being
  // valid — and sign the user out of the tab they are standing in.
  await refreshSessionAfterPasswordChange(session.userId);
  revalidatePath("/admin");
  return { ok: true };
}
