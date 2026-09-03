import Link from "next/link";
import type { Branch } from "@/lib/branches";
import { pageHref } from "@/lib/nav";

/**
 * A single rule and one line of small print. The client asked for the footer to
 * be reduced to the copyright, so the four-column block that used to live here
 * (hours, sitemap, branch switcher, award badge) is gone; everything it linked
 * to is now reachable from the header — see `fullNav` in lib/nav.
 *
 * Privacy and Terms are the one exception kept alongside the copyright. A UK
 * site that takes card payments and stores personal data has to make both
 * reachable from every page, and the header drawer alone doesn't do that on
 * desktop. They're set at the same weight as the copyright so the line still
 * reads as one quiet strip.
 */
export function SiteFooter({ branch }: { branch: Branch }) {
  return (
    <footer className="bg-ink border-t border-white/10">
      <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-8 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-xs text-pale/40">© {new Date().getFullYear()} Varanasi Restaurant</p>
        <nav aria-label="Legal" className="flex gap-5 text-xs text-pale/40">
          <Link href={pageHref(branch.slug, "privacy")} className="hover:text-gold">Privacy</Link>
          <Link href={pageHref(branch.slug, "terms")} className="hover:text-gold">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
