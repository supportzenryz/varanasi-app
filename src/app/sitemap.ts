import type { MetadataRoute } from "next";
import { allBranches } from "@/lib/branches";
import { db } from "@/db";
import { privateRooms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { siteUrl } from "@/lib/site";

/**
 * The sitemap, generated from the database rather than typed out.
 *
 * The client's stated priority for this move is that existing search rankings
 * survive it. Most of that is handled by the routes reusing the live site's
 * own slugs and by the 301s in src/lib/redirects.ts — but Google still has to
 * be told the new pages exist, and told promptly, or the first few weeks after
 * the cutover are spent waiting to be crawled.
 *
 * Built from `allBranches()` and the room table for a reason: a hand-written
 * list is correct on the day it is written and wrong the first time a private
 * dining room is added or a branch is unpublished in the admin. Nobody
 * remembers to edit a sitemap. This one cannot fall behind the site.
 *
 * Deliberately absent: /admin and everything under it (already `noindex` at
 * the header level), the checkout simulator, the /exact fallback pages, and
 * the per-code voucher pages — a gift voucher's URL is effectively its
 * password, and listing one in a sitemap would hand it to a crawler.
 */

/** Pages every branch has, with how strongly each should be crawled. */
const BRANCH_PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1.0, changeFrequency: "weekly" },
  { path: "/menu", priority: 0.9, changeFrequency: "weekly" },
  { path: "/drinks", priority: 0.8, changeFrequency: "weekly" },
  { path: "/book-online", priority: 0.9, changeFrequency: "monthly" },
  { path: "/private-dining-experiences", priority: 0.8, changeFrequency: "monthly" },
  { path: "/book-a-private-room", priority: 0.7, changeFrequency: "monthly" },
  { path: "/gift-vouchers", priority: 0.8, changeFrequency: "monthly" },
  { path: "/corporate-dining-events", priority: 0.6, changeFrequency: "monthly" },
  { path: "/catering", priority: 0.6, changeFrequency: "monthly" },
  { path: "/gallery", priority: 0.5, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.7, changeFrequency: "yearly" },
  { path: "/franchise-opportunities", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified, changeFrequency: "monthly", priority: 1.0 },
  ];

  for (const branch of allBranches()) {
    for (const page of BRANCH_PAGES) {
      entries.push({
        url: `${base}/${branch.slug}${page.path}`,
        lastModified,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
      });
    }

    /* Each private dining room has its own page, and they are the pages most
       worth ranking: somebody searching "private dining room Birmingham" is
       further down the line than somebody searching "indian restaurant". */
    const rooms = db.select({ slug: privateRooms.slug })
      .from(privateRooms)
      .where(and(eq(privateRooms.branchId, branch.id), eq(privateRooms.isPublished, true)))
      .all();

    for (const room of rooms) {
      entries.push({
        url: `${base}/${branch.slug}/private-dining-experiences/${room.slug}`,
        lastModified,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
