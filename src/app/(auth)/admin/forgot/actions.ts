"use server";
import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/password-reset";
import { checkEmail } from "@/lib/validate";
import { hit } from "@/lib/rate-limit";

/** Behind a proxy the socket address is the proxy's, so the client is the
 *  first hop. Only used for the audit trail and the per-address counter. */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * One answer, always the same.
 *
 * "We've emailed you a link" and "there is no such account" are two different
 * sentences, and the difference is a way to find out who works at this
 * restaurant — try an address, read the reply. A throttled request gets the
 * same sentence too, for the same reason. What actually happened is in the
 * audit log, where only the owner can read it.
 */
export async function requestResetAction(
  _prev: { done?: boolean; error?: string } | undefined,
  formData: FormData,
): Promise<{ done?: boolean; error?: string }> {
  const typed = String(formData.get("email") ?? "").trim();
  if (!typed) return { error: "Please enter the email address you sign in with." };

  const parsed = checkEmail(typed);
  // The only thing worth answering differently: a string that is not an email
  // address at all is a typo, not a probe, and telling someone their address
  // is malformed reveals nothing about who has an account.
  if (!parsed.ok) return { error: "That doesn't look like an email address." };

  /* The per-account limit lives in requestPasswordReset, but it only applies
     to addresses that HAVE an account — so without this, walking a list of
     guessed staff addresses was unlimited. Same sentence on screen either way,
     so the limit reveals nothing either. */
  const ip = await clientIp();
  const allowed = hit(`reset:ip:${ip}`, { max: 10, windowSeconds: 3600, blockSeconds: 3600 }).allowed;
  if (!allowed) return { done: true };

  try {
    await requestPasswordReset(parsed.value, { ip, siteUrl: siteUrl() });
  } catch (err) {
    /* A provider outage must not become "there is no such account", which is
       what a thrown error would look like on screen. Log it and give the same
       reassuring answer as always — the person can try again, and the log says
       why nothing arrived. */
    console.error("[password-reset] could not send the link:",
      err instanceof Error ? err.message : err);
  }

  return { done: true };
}
