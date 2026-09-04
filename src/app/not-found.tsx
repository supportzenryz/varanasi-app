import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import { allBranches } from "@/lib/branches";
import { brand } from "@/lib/brand";

export const metadata = { title: "Page not found" };

/**
 * The 404.
 *
 * There wasn't one, so a mistyped address — or, more likely, a booking link
 * truncated by an email client — landed a guest on Next's default white page
 * reading "404 | This page could not be found", with no mark, no navigation
 * and no way back, in the middle of a black-and-gold site. For the people this
 * restaurant is for, that is the moment the evening stops.
 *
 * So: the same ground as the rest of the site, an apology in plain words, both
 * restaurants one click away, and a phone number — because someone whose
 * confirmation link has broken usually wants a person, not a website.
 */
export default function NotFound() {
  const branches = allBranches();
  return (
    <main className="on-dark bg-ink text-pale min-h-dvh flex items-center justify-center px-5 py-20">
      <div className="w-full max-w-[46rem] text-center">
        <Image
          src={brand.logo}
          alt="Varanasi"
          width={520}
          height={104}
          priority
          className="mx-auto h-auto w-[min(20rem,70vw)]"
        />

        <p className="accent text-[0.62rem] text-gold mt-12">Page not found</p>
        <h1 className="display text-[2rem] sm:text-[2.6rem] leading-tight mt-4 text-balance">
          We can&rsquo;t find that page
        </h1>
        <p className="text-pale/70 mt-5 leading-relaxed max-w-[46ch] mx-auto">
          The address may have been mistyped, or a link may have been cut short on its
          way to you. Nothing is wrong with your booking.
        </p>

        <ul className="mt-12 mx-auto grid max-w-2xl gap-8 sm:grid-cols-2 sm:gap-0">
          {branches.map((b, i) => (
            <li key={b.id} className={i > 0 ? "sm:border-l sm:border-white/15 sm:pl-8" : "sm:pr-8"}>
              <Link href={`/${b.slug}`} className="group block">
                <span className="display block text-[1.9rem] text-gold leading-none transition-colors duration-300 group-hover:text-pale">
                  {b.city}
                </span>
                <span className="mt-3 block text-sm text-pale/60">{b.addressLine}</span>
                <span className="mt-2 block tnum text-sm text-pale/80">{b.phone}</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-sm text-pale/50 mt-12">
          If you were opening a booking confirmation, please call the restaurant and we&rsquo;ll
          find it for you.
        </p>
      </div>
    </main>
  );
}
