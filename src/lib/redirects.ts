/**
 * Redirects from the old site's URLs.
 *
 * The client's whole SEO concern is that existing rankings survive the move.
 * Most pages don't need a redirect at all — the rebuilt routes deliberately
 * reuse the live site's own slugs (`/birmingham/private-dining-experiences`,
 * not `/birmingham/private-dining`), so those URLs simply keep working.
 *
 * What DOES need redirecting is everything the old site had that the new one
 * doesn't: the 88 `/blog/dish/...` stubs, the root-level pages that served
 * Birmingham's content, the duplicate `/birmingham/birmingham/` path, and the
 * outgoing vendor's author page. All 301 (permanent), which is what tells
 * Google to move the ranking rather than treat it as a temporary detour.
 */
export type Redirect = { source: string; destination: string; permanent: boolean };

export const redirects: Redirect[] = [
  /* ---- root-level pages that served Birmingham content ----
     Sending these to the branch chooser rather than straight to Birmingham:
     the client's own front door asks people to pick a location, and guessing
     wrong sends Leicester's traffic to the wrong restaurant. */
  { source: "/menu", destination: "/", permanent: true },
  { source: "/contact", destination: "/", permanent: true },
  { source: "/catering", destination: "/", permanent: true },
  { source: "/gallery", destination: "/", permanent: true },
  { source: "/gift-vouchers", destination: "/", permanent: true },
  { source: "/private-dining-experiences", destination: "/", permanent: true },
  { source: "/corporate-dining-events", destination: "/", permanent: true },
  { source: "/franchise-opportunities", destination: "/", permanent: true },
  { source: "/book-online", destination: "/", permanent: true },
  { source: "/book-a-private-room", destination: "/", permanent: true },

  /* ---- the live duplicates ----
     `/birmingham/birmingham/` and `/leicester/birmingham/` were both live on
     the old site; the second is the bug where Leicester's location page sat
     under Birmingham's slug. */
  { source: "/birmingham/birmingham", destination: "/birmingham", permanent: true },
  { source: "/leicester/birmingham", destination: "/leicester", permanent: true },
  { source: "/leicester/leicester", destination: "/leicester", permanent: true },

  /* ---- the 88 dish stubs ----
     These were empty pages with no price and no image; the menu they belong to
     is now a real page, so that's where their traffic should land. Wildcard,
     because listing 88 near-identical rules would be unmaintainable. */
  { source: "/blog/dish/:slug*", destination: "/birmingham/menu", permanent: true },
  { source: "/birmingham/blog/dish/:slug*", destination: "/birmingham/menu", permanent: true },
  { source: "/leicester/blog/dish/:slug*", destination: "/leicester/menu", permanent: true },
  { source: "/dish/:slug*", destination: "/birmingham/menu", permanent: true },

  /* ---- WordPress and vendor leftovers that shouldn't be indexed ---- */
  { source: "/author/:name*", destination: "/", permanent: true },
  { source: "/blog", destination: "/", permanent: true },
  { source: "/category/:slug*", destination: "/", permanent: true },
  { source: "/tag/:slug*", destination: "/", permanent: true },
  { source: "/dish_cat/:slug*", destination: "/birmingham/menu", permanent: true },

  /* ---- WordPress admin paths: no longer exist, and shouldn't 404 noisily ---- */
  { source: "/wp-admin/:path*", destination: "/", permanent: true },
  { source: "/wp-login.php", destination: "/admin/login", permanent: true },
];

/**
 * Old sitemaps and feeds. Kept separate because these should 410/404 rather
 * than redirect — a feed that silently becomes a homepage confuses crawlers.
 * Handled as redirects to the real sitemap where one exists.
 */
export const feedRedirects: Redirect[] = [
  { source: "/feed", destination: "/sitemap.xml", permanent: true },
  { source: "/:branch/feed", destination: "/sitemap.xml", permanent: true },
  { source: "/sitemap_index.xml", destination: "/sitemap.xml", permanent: true },
];
