/**
 * Which pages exist as rebuilt, database-driven routes. Everything else falls
 * through to the exact copy of the original, so the site is walkable end to end
 * while it is converted page by page. Move a slug in here as it gets rebuilt.
 *
 * The slugs match the live site's URLs so nothing needs redirecting later.
 */
const REBUILT = new Set<string>([
  "",
  "menu",
  "drinks",
  "private-dining-experiences",
  "gallery",
  "book-online",
  "gift-vouchers",
  "contact",
  "corporate-dining-events",
  "catering",
  "franchise-opportunities",
  "privacy",
  "terms",
  "book-a-private-room",
]);

export function pageHref(branchSlug: string, slug = ""): string {
  const clean = slug.replace(/^\/|\/$/g, "");
  const base = clean ? `/${branchSlug}/${clean}` : `/${branchSlug}`;
  return REBUILT.has(clean) ? base : `/exact${base}`;
}
export const isRebuilt = (slug: string) => REBUILT.has(slug.replace(/^\/|\/$/g, ""));

/** The header's main navigation, in the live site's order.
 *
 *  Catering sits here rather than only in the footer. The page existed and the
 *  route worked, but nothing on the site linked to it, so it was effectively
 *  invisible — the client found it missing. Now that the footer is one line of
 *  small print, the header is the only place a page can be reached from, so
 *  every public page has to appear in one of these two lists. */
export function mainNav(branchSlug: string) {
  return [
    { href: pageHref(branchSlug, "menu"), label: "Our Menu" },
    { href: pageHref(branchSlug, "drinks"), label: "Drinks" },
    { href: pageHref(branchSlug, "book-online"), label: "Reservations" },
    { href: pageHref(branchSlug, "private-dining-experiences"), label: "Private Dining" },
    { href: pageHref(branchSlug, "catering"), label: "Catering" },
    { href: pageHref(branchSlug, "gallery"), label: "Gallery" },
    { href: pageHref(branchSlug, "gift-vouchers"), label: "Gift Vouchers" },
    { href: pageHref(branchSlug, "contact"), label: "Contact" },
  ];
}

/** Everything, for the mobile drawer. Must cover every public route, because
 *  the footer no longer carries a sitemap. */
export function fullNav(branchSlug: string) {
  return [
    ...mainNav(branchSlug).slice(0, 5),
    { href: pageHref(branchSlug, "corporate-dining-events"), label: "Corporate Events" },
    { href: pageHref(branchSlug, "book-a-private-room"), label: "Book a Private Room" },
    ...mainNav(branchSlug).slice(5),
    { href: pageHref(branchSlug, "franchise-opportunities"), label: "Franchise Opportunities" },
    { href: pageHref(branchSlug, "privacy"), label: "Privacy & GDPR" },
    { href: pageHref(branchSlug, "terms"), label: "Terms & Conditions" },
  ];
}
