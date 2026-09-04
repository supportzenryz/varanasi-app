import "server-only";
import { cookies } from "next/headers";

/**
 * Carries a rejected submission back to the form that produced it.
 *
 * Two problems, one mechanism.
 *
 * The first is that a rejected form lost everything. Every action redirects
 * back with `?error=…`, which re-renders the page empty — so a guest who
 * mistyped one character of their email retyped their name, phone, party size
 * and the message they had composed. On the voucher form that included the
 * personal note written for the recipient.
 *
 * The second is that the message itself travelled in the URL and was rendered
 * verbatim inside the site's own error box. That makes a crafted link a
 * ready-made phishing page wearing Varanasi's branding: `?error=Your card was
 * declined, call 0800…` renders exactly that, on the real domain. React
 * escapes markup so it is not script injection, but it does not need to be.
 *
 * Putting both the message and the values in a short-lived, server-set cookie
 * fixes both at once. The URL carries nothing but a flag, so there is nothing
 * left to forge; and the values come back with the message. Sixty seconds is
 * long enough for a redirect and short enough that a shared link or a return
 * visit never prefills someone else's details.
 */
const COOKIE = "varanasi_form";
const MAX_AGE = 60;

export type Recalled = { message: string; values: Record<string, string>; path: string };

/** Fields never worth keeping, or never safe to. */
const SKIP = new Set(["terms", "depositTerms", "depositRate", "marketing", "returnTo", "branch", "type"]);

export async function rememberSubmission(message: string, form: FormData, path: string): Promise<void> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (SKIP.has(k) || typeof v !== "string") continue;
    if (v.length > 4000) continue;              // don't push a huge cookie
    if (v) values[k] = v;
  }
  const jar = await cookies();
  jar.set(COOKIE, JSON.stringify({ message, values, path }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/**
 * Read on the next render, and only by the page that produced it.
 *
 * The path check is not incidental. The cookie is set for the whole site, so
 * without it a guest who hit an error on the catering form and then opened any
 * other page carrying `?error=1` would be shown the catering message on a form
 * it has nothing to do with. Observed exactly that in testing.
 *
 * Cookies cannot be cleared from a server component, so this relies on the
 * short lifetime to expire — which is also why callers should only ask when
 * the URL says a submission was just rejected.
 */
export async function recallSubmission(forPath: string): Promise<Recalled | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Recalled;
    if (typeof parsed?.message !== "string") return null;
    if (parsed.path !== forPath) return null;
    return { message: parsed.message, values: parsed.values ?? {}, path: parsed.path };
  } catch {
    return null;
  }
}
