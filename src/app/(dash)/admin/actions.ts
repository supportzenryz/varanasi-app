"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { record } from "@/lib/audit";
import { destroySession, getSession, requireSession, refreshSessionAfterPasswordChange } from "@/lib/auth";
import { passwordComplaint, BCRYPT_COST } from "@/lib/password-rules.mjs";
import { ok } from "@/lib/admin-feedback";

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

  if (next !== confirm) return { error: "The two new passwords don't match." };

  const row = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!row || !bcrypt.compareSync(current, row.passwordHash)) {
    return { error: "Your current password isn't right." };
  }

  /* The shared rules, not a local `length < 10`.
   *
   * This form used to be the weakest way into the system: ten characters of
   * anything, no check against the starting password. Since every new account
   * is created on that shared starting password and forced here to change it,
   * "type ChangeMe!2026 again" satisfied the gate — thirteen characters, no
   * rule broken — and the account stayed for ever on a password printed in
   * this repository. The rules now live in one module that this form and the
   * terminal recovery tool both import. */
  const complaint = passwordComplaint(next, {
    email: row.email,
    name: row.name,
    previous: current,
  });
  if (complaint) return { error: complaint };

  db.update(users)
    .set({ passwordHash: bcrypt.hashSync(next, BCRYPT_COST), mustChangePassword: false })
    .where(eq(users.id, session.userId)).run();
  record(session, { action: "password.change", entity: "user", entityId: String(session.userId) });

  // Re-issue from the row, not from the old session: the cookie is bound to a
  // fingerprint of the password hash, so reusing the previous session object
  // would hand back a cookie carrying the fingerprint that just stopped being
  // valid — and sign the user out of the tab they are standing in.
  await refreshSessionAfterPasswordChange(session.userId);
  revalidatePath("/admin");

  /* Somewhere to go, not a form to stare at.
   *
   * This returned `{ ok: true }`, so the screen stayed exactly where it was:
   * three filled-in password boxes, a green line reading "Saved", and no way
   * onward except the navigation. Worse for the case that matters most — a new
   * member of staff sent here on their first sign-in, who has no idea they are
   * now allowed in. Every other action in this admin ends by landing the
   * person somewhere with a sentence explaining what happened; this one is now
   * no different, and the place to land after being let in is the front page.
   *
   * `ok()` throws (it is a redirect), so nothing after this line runs. */
  ok("/admin", `Your new password is saved${row.mustChangePassword
    ? " — welcome in. This is your overview of both restaurants."
    : ". Use it next time you sign in."}`);
}
