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

  /* Everything a menu on a phone has to do, and none of which it did.
   *
   * The drawer opened as a panel pushed in under the header, with the same
   * three-line button still sitting above it — so there was no control that
   * read as "close", and the thirteen links ran off the bottom of the screen
   * while the page carried on scrolling behind them. A guest who opened it was
   * stuck with it.
   *
   * Escape closes it, because a keyboard is a keyboard even on a tablet with
   * one attached; and the page behind stops scrolling, because a drawer that
   * moves when you drag it is a drawer you cannot read. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header
      /* `print:hidden`: a printed page should be the content, not the
         navigation. It matters most for the gift voucher, which is meant to be
         printed and handed over, but nobody has ever wanted a paper copy of a
         menu with a sticky header across the top of it. */
      className={`print:hidden ${overlay ? "fixed" : "sticky"} top-0 inset-x-0 z-50 transition-colors duration-500 ${
        /* Solid while the menu is open, too. The bar is transparent over the
           hero until the page scrolls, and a transparent bar above an opaque
           drawer put the wordmark on top of a photograph. */
        /* Fully opaque when the menu is open, 95% when merely scrolled. The
           translucent bar let a sliver of the hero photograph through above a
           solid drawer, which read as a seam across the top of the screen. */
        open ? "bg-ink border-b border-white/10"
          : solid ? "bg-ink/95 backdrop-blur-sm border-b border-white/10"
          : "bg-gradient-to-b from-ink/75 to-transparent"
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
            {/* Three lines that become a cross. The old button stayed three
                lines whether the menu was open or shut, which is the whole of
                the "I cannot close it" problem: the control was there and did
                not look like a way out. */}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="xl:hidden relative z-[70] text-pale p-3 -mr-3 grid place-items-center"
            >
              <span className="sr-only">{open ? "Close menu" : "Menu"}</span>
              <span aria-hidden="true" className="relative block h-4 w-6">
                <span className={`absolute inset-x-0 h-px bg-current transition-all duration-200 ${
                  open ? "top-1/2 rotate-45" : "top-0"}`} />
                <span className={`absolute inset-x-0 top-1/2 h-px bg-current transition-opacity duration-200 ${
                  open ? "opacity-0" : "opacity-100"}`} />
                <span className={`absolute inset-x-0 h-px bg-current transition-all duration-200 ${
                  open ? "top-1/2 -rotate-45" : "bottom-0"}`} />
              </span>
            </button>
          </div>
        </div>
      </div>

      {open && (
        <>
          {/* Tap anywhere off the panel to close. Obvious to anyone who has
              used a phone, and impossible with the old inline panel. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="xl:hidden fixed inset-x-0 top-20 sm:top-24 bottom-0 z-[55] bg-ink/70 backdrop-blur-sm"
          />

          {/* Its own scroll container, and a height it cannot exceed. Thirteen
              links plus a button do not fit on a phone in portrait, so the
              panel scrolls and the bar above it stays put — rather than the
              page scrolling and the close control sliding away with it.
              `dvh`, not `vh`: on iOS the address bar makes `vh` taller than
              the screen, which hides the last item behind it. */}
          <div
            id="site-menu"
            /* Below the bar, not over it. The first version started at the top
               of the screen and padded itself down past the header, which hid
               the wordmark and left an empty corner with a lone cross in it —
               so the one thing on screen identifying the restaurant vanished
               the moment you opened the menu. Starting below the bar keeps the
               logo, the bar and the cross all visible and needs no second copy
               of the logo inside the panel.

               The height is the screen minus the bar, in `dvh`: on iOS `vh`
               is taller than the visible area while the address bar is
               showing, which pushes the last item out of reach. */
            className="xl:hidden fixed inset-x-0 top-20 sm:top-24 z-[60]
                       max-h-[calc(100dvh-5rem)] sm:max-h-[calc(100dvh-6rem)]
                       overflow-y-auto overscroll-contain
                       bg-ink border-b border-white/10 pt-2
                       [padding-bottom:calc(2rem+env(safe-area-inset-bottom))]"
          >
            <nav aria-label="Main, mobile" className="mx-auto max-w-[84rem] px-5 grid gap-1">
              {(allLinks ?? links).map((l) => (
                <Link key={l.href + l.label} href={l.href} onClick={() => setOpen(false)}
                  className="py-3 text-pale/85 hover:text-gold border-b border-white/5">
                  {l.label}
                </Link>
              ))}
              <Link href="/" onClick={() => setOpen(false)}
                className="accent text-[0.68rem] text-gold/90 py-3 hover:text-gold">
                All locations
              </Link>
              <Link href={bookHref} onClick={() => setOpen(false)} className="btn btn-gold text-center mt-3">
                Book a table
              </Link>
              <a href={telHref} className="tnum text-center text-sm text-pale/70 mt-3 py-2">{phone}</a>
              {/* A second way out, at the end of the list — where a thumb
                  already is after scrolling to the bottom. */}
              <button type="button" onClick={() => setOpen(false)}
                className="mt-2 py-3 text-center text-xs uppercase tracking-[0.18em] text-pale/50 hover:text-pale">
                Close
              </button>
            </nav>
          </div>
        </>
      )}
    </header>
  );
}
