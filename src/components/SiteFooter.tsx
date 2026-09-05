import Link from "next/link";
import Image from "next/image";
import { allBranches, openingHours, telHref, type Branch } from "@/lib/branches";
import { pageHref } from "@/lib/nav";
import { brand } from "@/lib/brand";
import { JaliBand } from "@/components/Ornament";

/**
 * The footer.
 *
 * It was one line of copyright for a while, at the client's request, and it is
 * back at the client's request. Worth recording why the full version is the
 * right default for this particular site rather than just more of it:
 *
 *  - A restaurant footer is a utility. Address, telephone and today's hours
 *    are the three things a person wants at the moment they decide to come,
 *    and that moment happens at the bottom of a page as often as the top.
 *  - It is the only place both restaurants appear together on a branch page.
 *    Somebody who landed on Leicester from a search and actually wants
 *    Birmingham has, until here, no way across.
 *  - Google reads a consistent name, address and phone in the footer of every
 *    page as a local-business signal. One line of copyright gives it nothing.
 *
 * The hours are rendered live from the same data the booking system uses, so
 * the footer cannot drift from what the restaurant is actually open for — a
 * footer with last year's hours in it is worse than no footer.
 */
export function SiteFooter({ branch }: { branch: Branch }) {
  const hours = openingHours(branch);
  const others = allBranches().filter((b) => b.slug !== branch.slug);
  const year = new Date().getFullYear();

  const col = "text-sm text-pale/65 leading-relaxed";
  const head = "accent text-[0.6rem] text-gold";
  const link = "block py-1 text-sm text-pale/65 hover:text-gold transition-colors";

  return (
    <footer className="bg-ink border-t border-white/10">
      <JaliBand className="opacity-30" />

      <div className="mx-auto max-w-[84rem] px-5 lg:px-10 pt-16 pb-10">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">

          {/* 1 — who and where */}
          <div>
            <Image src={brand.logo} alt="Varanasi" width={520} height={104}
              className="h-9 w-auto" />
            <address className={`${col} not-italic mt-5`}>
              {branch.addressLine}<br />
              {branch.city}, {branch.postcode}
            </address>
            <a href={telHref(branch.phone)} className="tnum mt-4 inline-block font-semibold hover:text-gold">
              {branch.phone}
            </a>
            {branch.bookingEmail && (
              <a href={`mailto:${branch.bookingEmail}`} className="block mt-1.5 text-sm text-pale/65 hover:text-gold">
                {branch.bookingEmail}
              </a>
            )}
            {branch.mapsUrl && (
              <a href={branch.mapsUrl} target="_blank" rel="noopener noreferrer"
                className="mt-4 inline-block text-sm text-gold hover:underline">
                Open in Google Maps
              </a>
            )}
          </div>

          {/* 2 — the hours, live from the booking data */}
          <div>
            <p className={head}>Opening hours</p>
            <ul className="mt-4">
              {hours.map((h) => (
                <li key={h.day} className="flex justify-between gap-4 py-1 text-sm text-pale/65">
                  <span>{h.day}</span>
                  <span className="tnum">{h.closed ? "Closed" : `${h.open} – ${h.close}`}</span>
                </li>
              ))}
            </ul>
            {branch.openingNote && (
              <p className="mt-3 text-xs text-pale/45">{branch.openingNote}</p>
            )}
          </div>

          {/* 3 — everywhere you can go from here */}
          <div>
            <p className={head}>Explore</p>
            <nav aria-label="Footer" className="mt-3">
              {[
                ["Our Menu", "menu"], ["Drinks & Cocktails", "drinks"],
                ["Reservations", "book-online"], ["Private Dining", "private-dining-experiences"],
                ["Corporate Events", "corporate-dining-events"], ["Catering", "catering"],
                ["Gallery", "gallery"], ["Gift Vouchers", "gift-vouchers"],
                ["Contact", "contact"], ["Franchise Opportunities", "franchise-opportunities"],
              ].map(([label, slug]) => (
                <Link key={slug} href={pageHref(branch.slug, slug)} className={link}>{label}</Link>
              ))}
            </nav>
          </div>

          {/* 4 — the other restaurant, and the award */}
          <div>
            <p className={head}>Our restaurants</p>
            <ul className="mt-4 space-y-4">
              <li>
                <span className="text-sm font-semibold">Varanasi {branch.city}</span>
                <span className="block text-xs text-pale/45 mt-0.5">You are here</span>
              </li>
              {others.map((b) => (
                <li key={b.slug}>
                  {/* The only route between the two restaurants on a branch
                      page. Someone who landed here from a search for the other
                      city has no other way across. */}
                  <Link href={`/${b.slug}`} className="text-sm font-semibold hover:text-gold">
                    Varanasi {b.city}
                  </Link>
                  <span className="block text-xs text-pale/45 mt-0.5">
                    {b.addressLine}, {b.postcode}
                  </span>
                  <a href={telHref(b.phone)} className="tnum block text-xs text-pale/45 mt-0.5 hover:text-gold">
                    {b.phone}
                  </a>
                </li>
              ))}
            </ul>

            <Link href={pageHref(branch.slug, "book-online")} className="btn btn-gold mt-7">
              Book a table
            </Link>

            {brand.award && (
              <Image src={brand.award} alt={brand.awardAlt} width={130} height={130}
                className="mt-8 h-auto w-[84px] opacity-85" />
            )}
          </div>
        </div>

        {/* The line that was here on its own. Privacy and Terms sit with the
            copyright because a UK site taking card payments and holding
            personal data has to make both reachable from every page. */}
        <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 pt-7">
          <p className="text-xs text-pale/40">© {year} Varanasi Restaurant</p>
          <nav aria-label="Legal" className="flex gap-5 text-xs text-pale/40">
            <Link href={pageHref(branch.slug, "privacy")} className="hover:text-gold">Privacy &amp; GDPR</Link>
            <Link href={pageHref(branch.slug, "terms")} className="hover:text-gold">Terms &amp; Conditions</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
