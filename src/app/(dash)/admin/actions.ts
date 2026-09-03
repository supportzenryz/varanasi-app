"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, auditLog } from "@/db/schema";
import { destroySession, requireSession, createSession } from "@/lib/auth";

export async function logoutAction() {
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
  db.insert(auditLog).values({
    userId: session.userId, action: "password.change", entity: "user", entityId: String(session.userId),
  }).run();

  await createSession({ ...session, mustChangePassword: false });
  revalidatePath("/admin");
  return { ok: true };
}
