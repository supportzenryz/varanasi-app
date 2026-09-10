"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "./actions";

export type NavItem = { href: string; label: string; ready: boolean };

/**
 * The admin's navigation, in the two shapes it needs.
 *
 * On a laptop it is the left rail it always was. On a phone it was a disaster:
 * the rail became a horizontal row holding the logo, a sideways-scrolling strip
 * of thirteen sections and a Sign out button — which on a 390px screen left the
 * sections about ninety pixels of scrollable window between the other two. The
 * screenshot from the client's phone shows the result: "access", "Settin", and
 * no way to reach anything. A previous fix had made only the links scroll
 * rather than the whole rail, which stopped Sign out being 1,400px off-screen
 * and left the sections just as unusable.
 *
 * A strip that has to be scrubbed sideways is the wrong shape for thirteen
 * items. So on a phone this is a bar and a drawer, like the public site: one
 * button, the full list, and somewhere obvious to press to get out of it.
 *
 * A client component because a drawer has state, and because knowing which
 * section you are in needs the current path — which the admin never showed at
 * all, on any screen size.
 */
export function AdminNav({
  items, name, role, branch,
}: {
  items: NavItem[];
  name: string;
  role: string;
  branch: string;
}) {
  const pathname = usePathname();

  /* Derived, not synchronised.
   *
   * "Close the drawer when the route changes" was an effect calling setState,
   * which eslint's react-hooks rule refuses — and rightly: it renders once with
   * the drawer open over the new page, then again to close it. Storing *which
   * page it was opened on* answers the same question without a second render.
   * A path change makes `open` false on its own. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  // Escape closes it, and the page behind it stops scrolling while it is open.
  useEffect(() => {
    if (!open) return;
    /* `setOpenedAt` rather than the `setOpen` helper: the helper is recreated
       on every render, so naming it as a dependency would re-subscribe the
       listener each time. The setter React gives us is stable. */
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenedAt(null); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  /** `/admin` matches only itself; everything else matches its own subtree, so
   *  `/admin/menu/leicester` still highlights "Menus & drinks". */
  const isCurrent = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const link = (item: NavItem, mobile: boolean) => {
    const current = isCurrent(item.href);
    if (!item.ready) {
      return (
        <span key={item.href} aria-disabled="true"
          className={`text-sm text-pale/30 border-l-2 border-transparent flex items-baseline gap-2 ${
            mobile ? "px-5 py-3" : "px-6 py-2.5"}`}>
          {item.label}
          <span className="text-[0.58rem] uppercase tracking-widest text-gold/50">Soon</span>
        </span>
      );
    }
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={current ? "page" : undefined}
        className={`text-sm border-l-2 transition-colors ${mobile ? "px-5 py-3" : "px-6 py-2.5"} ${
          current
            ? "border-gold bg-white/5 text-pale font-semibold"
            : "border-transparent text-pale/70 hover:text-pale hover:bg-white/5 hover:border-gold"
        }`}
      >
        {item.label}
      </Link>
    );
  };

  const account = (
    <>
      <p className="text-sm font-semibold leading-tight">{name}</p>
      <p className="text-xs text-pale/50 mt-0.5 capitalize">{role} &middot; {branch}</p>
      <form action={logoutAction}>
        <button className="mt-3 text-xs text-gold hover:underline border border-gold/30 px-3 py-2">
          Sign out
        </button>
      </form>
    </>
  );

  return (
    <>
      {/* ---------- the rail, from lg up ---------- */}
      <aside className="hidden lg:flex bg-ink text-pale min-h-dvh flex-col py-7">
        <Link href="/admin" className="shrink-0 px-6 mb-7 flex flex-col items-start gap-2">
          <Image src="/brand/logo.png" alt="Varanasi" width={520} height={104}
            className="h-10 w-auto self-start" priority />
          <span className="accent text-gold/70">Admin</span>
        </Link>

        <nav aria-label="Admin sections" className="flex flex-col flex-1 min-w-0">
          {items.map((item) => link(item, false))}
        </nav>

        <div className="px-6 pt-6 border-t border-white/10 shrink-0">{account}</div>
      </aside>

      {/* ---------- the bar, below lg ---------- */}
      <div className="lg:hidden sticky top-0 z-50 bg-ink text-pale border-b border-white/10">
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <Link href="/admin" className="flex items-center gap-2.5 min-w-0">
            <Image src="/brand/logo.png" alt="Varanasi" width={520} height={104}
              className="h-7 w-auto shrink-0" priority />
            <span className="accent text-[0.55rem] text-gold/70 shrink-0">Admin</span>
          </Link>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="admin-menu"
            className="flex items-center gap-2 border border-gold/30 px-3 py-2 text-xs text-gold shrink-0"
          >
            {open ? "Close" : "Menu"}
            <span aria-hidden="true" className="relative block h-3.5 w-4">
              <span className={`absolute inset-x-0 h-px bg-current transition-all duration-200 ${
                open ? "top-1/2 rotate-45" : "top-0"}`} />
              <span className={`absolute inset-x-0 top-1/2 h-px bg-current transition-opacity duration-200 ${
                open ? "opacity-0" : "opacity-100"}`} />
              <span className={`absolute inset-x-0 h-px bg-current transition-all duration-200 ${
                open ? "top-1/2 -rotate-45" : "bottom-0"}`} />
            </span>
          </button>
        </div>

        {/* Which screen you are on, when the rail that would have told you is
            behind a button. */}
        {!open && (
          <p className="px-5 pb-2.5 text-[0.7rem] text-pale/45">
            {items.find((i) => isCurrent(i.href))?.label ?? "Admin"}
          </p>
        )}
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="lg:hidden fixed inset-0 z-[55] bg-ink/70 backdrop-blur-sm"
          />
          <div
            id="admin-menu"
            className="lg:hidden fixed inset-x-0 top-0 z-[60] max-h-dvh overflow-y-auto overscroll-contain
                       bg-ink text-pale border-b border-white/10
                       [padding-bottom:calc(1.5rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-white/10">
              <span className="accent text-[0.6rem] text-gold/70">Admin</span>
              <button type="button" onClick={() => setOpen(false)}
                className="border border-gold/30 px-3 py-2 text-xs text-gold">
                Close
              </button>
            </div>

            <nav aria-label="Admin sections, mobile" className="flex flex-col py-2">
              {items.map((item) => link(item, true))}
            </nav>

            <div className="px-5 pt-5 mt-2 border-t border-white/10">{account}</div>
          </div>
        </>
      )}
    </>
  );
}
