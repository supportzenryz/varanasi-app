"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, verifyLogin } from "@/lib/auth";
import { record, recordAnon } from "@/lib/audit";
import { lockedFor, noteFailure, noteSuccess } from "@/lib/login-guard";
import { checkEmail } from "@/lib/validate";

/** Behind Railway's proxy the socket address is the proxy, so the client is
 *  the first hop in x-forwarded-for. Falls back to a constant, which simply
 *  means the per-address counter behaves as one shared bucket. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();

  if (!email || !password) return { error: "Enter your email and password." };

  /* Validated before it reaches the database. Not for the database's sake —
     the query is parameterised — but so that a malformed address is answered
     without spending a bcrypt comparison, and so the audit trail records
     something legible rather than 400 characters of junk. */
  const parsed = checkEmail(email);
  if (!parsed.ok) return { error: "That doesn't look like an email address." };

  const wait = lockedFor(email, ip);
  if (wait) {
    return {
      error: `Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}, ` +
        `or ask an owner to reset your password.`,
    };
  }

  const session = await verifyLogin(parsed.value, password);

  if (!session) {
    const locked = noteFailure(email, ip);
    recordAnon({
      action: locked ? "login.locked" : "login.failed",
      entity: "user",
      entityId: parsed.value,
      detail: `from ${ip}`,
      who: `${parsed.value} from ${ip}`,
    });
    // The same sentence whether the address exists or not: a different answer
    // for a real account turns the form into a list of who works here.
    return { error: "Those details don't match an active account." };
  }

  noteSuccess(email, ip);
  await createSession(session);
  record(session, { action: "login.ok", entity: "user", entityId: String(session.userId), detail: `from ${ip}` });
  redirect(session.mustChangePassword ? "/admin/password" : "/admin");
}
