import Image from "next/image";
import { field, label } from "@/lib/forms";

/**
 * The frame around every screen you see before you are signed in: sign in,
 * forgotten password, set a new one.
 *
 * One component because three near-copies of a two-panel layout is three
 * places for the logo to be the wrong size, and the sign-in panel has already
 * had that exact bug once — a column flex container stretched a 5:1 mark out
 * to 10:1, because `align-items: stretch` overrides `width: auto`. `self-start`
 * below is what stops it, and now there is only one of it.
 */
export function AuthShell({
  kicker, heading, intro, children, aside,
}: {
  kicker: string;
  heading: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <main className="dash min-h-dvh grid lg:grid-cols-2 bg-pale text-ink">
      <div className="hidden lg:flex flex-col justify-between bg-ink text-pale p-12">
        <Image src="/brand/logo.png" alt="Varanasi" width={520} height={104}
          className="h-14 w-auto self-start" priority />
        <div>
          <h1 className="text-4xl leading-tight max-w-[14ch]">The room behind the restaurant.</h1>
          <p className="mt-4 text-pale/70 max-w-[38ch] text-sm leading-relaxed">
            Menus, private rooms, gift vouchers and enquiries for Birmingham and Leicester — in one place.
          </p>
        </div>
        <span className="text-pale/40 text-xs">Staff access only</span>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Narrow screens lose the dark panel, so this side carries the mark
              itself — in the ink variant, since it is cream here. */}
          <Image src="/brand/logo-dark.png" alt="Varanasi" width={520} height={104}
            className="lg:hidden h-11 w-auto mb-8" priority />
          <span className="accent text-xs text-gold-ink">{kicker}</span>
          <h2 className="text-3xl mt-3">{heading}</h2>
          {intro && <p className="text-ink-3 text-sm mt-2 mb-8">{intro}</p>}
          {children}
          {aside}
        </div>
      </div>
    </main>
  );
}

/* The sign-in screens use the same controls as everything else.
 *
 * These were a fifteenth copy of the string the forms refactor existed to
 * delete — and the one place it did not reach, because `src/lib/forms.ts`
 * documents "fourteen" and nobody goes looking for a fifteenth. AuthShell
 * renders inside `<main className="dash …">`, so `.field` and `.field-label`
 * already resolve here; the screens now also get the gold focus ring, the
 * `:user-invalid` state and the autofill fix they were missing.
 *
 * Kept as re-exports rather than edited at all five call sites: the names read
 * well on those pages, and the point is that there is one definition. */
export const authField = field;
export const authLabel = label;
export const authButton =
  "mt-7 w-full bg-ink text-pale py-3 text-sm font-semibold tracking-wide hover:bg-ink-2 disabled:opacity-60";
