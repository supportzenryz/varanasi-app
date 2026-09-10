import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * What crawlers may look at.
 *
 * The admin is already `X-Robots-Tag: noindex, nofollow, noarchive` at the
 * header level, which is the rule that actually binds — robots.txt is a
 * request, not an instruction, and a header is enforced. This is the belt to
 * that pair of braces, and it does one thing the header cannot: it stops a
 * crawler asking for those URLs at all, which keeps the admin out of the
 * "pages we tried and were told to go away" reports the client will read.
 *
 * Three paths are disallowed for reasons other than tidiness:
 *
 *   /admin              staff only, and every page of it is `no-store`
 *   /*?code=            a gift voucher's code is effectively its password;
 *                       any URL carrying one must never be crawled or cached
 *   /checkout-simulator the local stand-in for Stripe, which has no business
 *                       existing in an index even by accident
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/checkout-simulator", "/exact", "/*?code="],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
