import Script from "next/script";
import type { AnalyticsRules } from "@/lib/booking-config";

/**
 * Cookieless analytics, and no cookie banner.
 *
 * WHAT WAS HERE BEFORE, and why it went. This was GA4 behind a consent gate:
 * a client component that read localStorage, showed an accept/decline bar
 * along the bottom of every page, and loaded Google's tag only after somebody
 * pressed Accept. It was carefully written and it measured nothing, for two
 * separate reasons:
 *
 *  1. No measurement ID was ever set, so the gate never opened.
 *  2. Even with one, the site's Content-Security-Policy allows scripts from
 *     'self' only. googletagmanager.com was never on that list, so the browser
 *     would have refused to load the tag — silently, as CSP does. The banner
 *     would have appeared, the guest would have pressed Accept, and the number
 *     of visitors recorded would have been zero.
 *
 * The replacement counts visitors without identifying them: no cookies, no
 * localStorage, no cross-site identifier, nothing stored on the device at all.
 * That matters for more than principle. Analytics cookies need consent under
 * PECR, and consent means a banner; a banner is the first thing a guest sees
 * on a page selling fine dining, and between 40% and 45% of people decline it,
 * so the numbers underneath are missing nearly half the audience and nobody
 * can say which half. Measuring without cookies needs no banner and counts
 * everyone.
 *
 * Two providers are supported because they are interchangeable and the client
 * may already have one: Plausible identifies a site by its domain, Umami by an
 * id. Set neither and nothing is rendered — no script, no request, no banner.
 * The CSP in next.config.ts is widened to exactly the host configured here and
 * no other.
 */
export function Analytics({ rules }: { rules: AnalyticsRules }) {
  if (rules.provider === "none" || !rules.scriptUrl) return null;

  if (rules.provider === "umami") {
    if (!rules.websiteId) return null;
    return (
      <Script
        src={rules.scriptUrl}
        data-website-id={rules.websiteId}
        strategy="afterInteractive"
        defer
      />
    );
  }

  // Plausible.
  if (!rules.domain) return null;
  return (
    <Script
      src={rules.scriptUrl}
      data-domain={rules.domain}
      strategy="afterInteractive"
      defer
    />
  );
}
