"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

export type HeaderLink = { href: string; label: string };

/**
 * Sits transparent over a full-bleed hero and turns solid once the page moves,
 * which is how the live site behaves. Rendered as a client component only for
 * that scroll state — every link is resolved on the server and passed in.
 */
export function SiteHeader({
  homeHref, city, phone, telHref, bookHref, logo, links, allLinks, overlay = false,
}: {
  homeHref: string;
  city: string;
  phone: string;
  telHref: string;
  bookHref: string;
  logo: string;
  /** shown in the bar on large screens */
  links: HeaderLink[];
  /** the full set, shown in the mobile drawer */
  allLinks?: HeaderLink[];
  overlay?: boolean;
}) {
  const [solid, setSolid] = useState(!overlay);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overlay]);

  return (
    <header
      className={`${overlay ? "fixed" : "sticky"} top-0 inset-x-0 z-50 transition-colors duration-500 ${
        solid ? "bg-ink/95 backdrop-blur-sm border-b border-white/10" : "bg-gradient-to-b from-ink/75 to-transparent"
      }`}
    >
      <div className="mx-auto max-w-[84rem] px-5 lg:px-10">
        <div className="flex items-center justify-between gap-6 h-20 sm:h-24">
          <Link href={homeHref} className="flex items-center gap-3 shrink-0" aria-label={`Varanasi ${city}`}>
            <Image src={logo} alt="Varanasi" width={150} height={104}
              className="h-11 sm:h-14 w-auto" priority />
          </Link>

          {/* The live site has no way back to the root "choose a location" page once
              you're on a branch — the client flagged this. The city name doubles as
              that switcher: it's exactly where a visitor looks to confirm which
              restaurant they're on, so it's the natural place to change it too. */}
          <Link
            href="/"
            className="accent text-[0.58rem] text-gold/90 hidden 2xl:flex items-center gap-1.5 hover:text-gold shrink-0 -ml-3"
            aria-label={`Varanasi ${city} — switch location`}
          >
            {city}
            <svg width="7" height="7" viewBox="0 0 10 10" fill="none" aria-hidden="true" className="opacity-70">
              <path d="M2 2l6 6M8 2v6H2" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </Link>

          <nav aria-label="Main" className="hidden xl:flex items-center gap-x-3.5 2xl:gap-x-5 text-[0.78rem] text-pale/85">
            {links.map((l) => (
              <Link key={l.href + l.label} href={l.href} className="whitespace-nowrap hover:text-gold transition-colors">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            <a href={telHref} className="hidden 2xl:inline tnum text-sm text-pale/85 hover:text-gold">{phone}</a>
            <Link href={bookHref} className="btn btn-gold hidden sm:inline-block !py-2.5 !px-5">Book a table</Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Menu"
              className="xl:hidden text-pale p-2 -mr-2"
            >
              <span className="block w-6 h-px bg-current" />
              <span className="block w-6 h-px bg-current mt-1.5" />
              <span className="block w-6 h-px bg-current mt-1.5" />
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="xl:hidden bg-ink border-t border-white/10">
          <nav aria-label="Main, mobile" className="mx-auto max-w-[84rem] px-5 py-4 grid gap-1">
            {(allLinks ?? links).map((l) => (
              <Link key={l.href + l.label} href={l.href} onClick={() => setOpen(false)}
                className="py-2.5 text-pale/85 hover:text-gold border-b border-white/5">
                {l.label}
              </Link>
            ))}
            <Link href="/" onClick={() => setOpen(false)}
              className="accent text-[0.68rem] text-gold/90 py-2.5 hover:text-gold">
              All locations
            </Link>
            <Link href={bookHref} onClick={() => setOpen(false)} className="btn btn-gold text-center mt-3">
              Book a table
            </Link>
            <a href={telHref} className="tnum text-center text-sm text-pale/70 mt-3">{phone}</a>
          </nav>
        </div>
      )}
    </header>
  );
}
