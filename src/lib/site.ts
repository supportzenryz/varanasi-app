import "server-only";

/**
 * The site's own address, in one place.
 *
 * There were fourteen copies of this expression and three different versions
 * of it, which is two more than a one-line expression can afford:
 *
 *   (process.env.SITE_URL ?? "https://varanasi.uk").replace(/\/+$/, "")
 *   (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")
 *    process.env.SITE_URL ?? "https://varanasi.uk"          // no strip at all
 *
 * The third one is a real defect rather than untidiness. It is used by the
 * booking confirmation, the cancellation notice and the reminder — the three
 * emails whose links a guest actually presses — so setting SITE_URL with a
 * trailing slash, which is how most people write a URL, produced
 * `https://varanasi.uk//birmingham/book-online` in a guest's inbox while every
 * other message in the system stripped it correctly. A double slash is not
 * always fatal, and "not always" is the problem: it works in testing and
 * breaks against whichever proxy or link-checker decides it is a different
 * path.
 *
 * The two defaults also disagreed, and one of them is dangerous. Four call
 * sites fell back to `http://localhost:3000` — including the gift voucher
 * links and the password reset email. In development that is right; in a
 * production deployment where SITE_URL was forgotten it means posting a guest
 * a link to their own machine. So the fallback now depends on which one it is,
 * and says so out loud rather than silently picking.
 */

let warned = false;

export function siteUrl(): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      warned = true;
      console.warn(
        "[site] SITE_URL is not set. Falling back to https://varanasi.uk so that links in "
        + "emails point at a real site rather than at localhost — but set it, because every "
        + "voucher link, booking link and password reset carries this address.",
      );
    }
    return "https://varanasi.uk";
  }
  return "http://localhost:3000";
}

/** `siteUrl()` with a path appended, with exactly one slash between them. */
export function siteHref(path: string): string {
  return `${siteUrl()}/${path.replace(/^\/+/, "")}`;
}
