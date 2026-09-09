import "server-only";
import { headers } from "next/headers";
import { hit } from "@/lib/rate-limit";
import { recordAnon } from "@/lib/audit";

/**
 * Limits on the forms anyone on the internet can post to.
 *
 * There were none. The only thing standing between the enquiry form and a loop
 * in a browser console was a 120-second same-payload check, which a changed
 * character defeats. Each submission writes a row, sends an email to the
 * restaurant and sends an acknowledgement to whatever address was typed — so
 * an afternoon of that is the restaurant's monthly email quota gone, its inbox
 * unusable, and the real enquiry from a wedding party buried in three thousand
 * fakes. The booking form is worse in a different way: every submission holds
 * a table for the length of the deposit window, so a script can take a
 * Saturday night off sale without paying for anything.
 *
 * Three buckets per form, because one is not enough:
 *
 *   by address   the obvious one, and the easiest to evade
 *   by email     survives an attacker rotating addresses, since a form that
 *                sends a confirmation has to be given somewhere to send it
 *   overall      a blunt backstop, well above any real day's traffic, so a
 *                distributed flood still hits something
 *
 * The address is read from `x-forwarded-for`, which a client can set for
 * itself if it can reach the app directly. That is precisely why it is not the
 * only bucket: spoofing the header gets you past the first one and straight
 * into the other two.
 */

/** The client's address as best we can tell, for counting and for the log. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

const HOUR = 3600;

/** Per form, per hour. Generous for a restaurant, tedious for a script. */
const LIMITS = {
  enquiry: { perIp: 10, perEmail: 5, overall: 300 },
  booking: { perIp: 8, perEmail: 5, overall: 200 },
  voucher: { perIp: 6, perEmail: 4, overall: 100 },
} as const;

export type PublicForm = keyof typeof LIMITS;

export type Guard = { allowed: true } | { allowed: false; message: string };

/**
 * Count one submission and say whether it may proceed.
 *
 * The refusal is written in the voice of the rest of the site and points at
 * the telephone, because the one person a limit like this will ever
 * inconvenience is a real guest who pressed the button twice too often — and
 * for them, "ring us" is a better answer than "rate limit exceeded".
 */
export async function guardPublicForm(
  form: PublicForm,
  opts: { email?: string | null; phone?: string | null } = {},
): Promise<Guard> {
  const limit = LIMITS[form];
  const ip = await clientIp();
  const email = (opts.email ?? "").trim().toLowerCase();

  const checks = [
    { key: `${form}:ip:${ip}`, max: limit.perIp, what: `address ${ip}` },
    ...(email ? [{ key: `${form}:email:${email}`, max: limit.perEmail, what: email }] : []),
    { key: `${form}:all`, max: limit.overall, what: "the form overall" },
  ];

  for (const check of checks) {
    const verdict = hit(check.key, { max: check.max, windowSeconds: HOUR, blockSeconds: HOUR });
    if (verdict.allowed) continue;

    /* Recorded, because from the restaurant's side this is the only visible
       sign that someone is hammering the site — and because the alternative
       reading of "the form stopped working" is a bug report. */
    recordAnon({
      action: `form.limited.${form}`,
      entity: "form",
      entityId: form,
      detail: `refused: ${check.what} passed ${check.max} in an hour`,
      who: ip,
    });

    return {
      allowed: false,
      message: form === "booking"
        ? "That's a lot of attempts in a short time, so we've paused this form for a little while. "
          + "Please ring the restaurant and we'll book you in straight away."
        : "That's a lot of messages in a short time, so we've paused this form for a little while. "
          + "If it's urgent, please ring us — we'd much rather speak to you.",
    };
  }

  return { allowed: true };
}
