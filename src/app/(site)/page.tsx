import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { allBranches } from "@/lib/branches";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  // absolute, or the root layout's "%s | Varanasi" template appends a
  // second Varanasi and the tab reads "… | Varanasi | Varanasi".
  title: { absolute: "Varanasi | Indian Fine Dining" },
  description:
    "Indian fine dining in Birmingham and Leicester. Choose your restaurant to see menus, book a table or buy a gift voucher.",
  alternates: { canonical: "/" },
  openGraph: { images: [brand.socialImage] },
};

/**
 * The front door.
 *
 * The photograph behind this already carries the Buddha and the wordmark, so
 * the logo asset that used to sit on top of it was the same mark printed
 * twice. It has been dropped in favour of the name set in gold, which leaves
 * the photograph legible and the page quieter.
 *
 * The two restaurants sit side by side rather than stacked: they are a choice
 * between equals, and a column implies a first and a second. Each carries its
 * street address, which was previously screen-reader-only — a visitor deciding
 * between Birmingham and Leicester is usually deciding on geography, so the
 * address is the useful part and should be visible.
 */
export default function ChooseBranch() {
  const branches = allBranches();

  return (
    <main className="relative isolate min-h-svh flex items-center justify-center overflow-hidden bg-ink">
      <Image
        src="/brand/home-hero.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center -z-20"
      />
      <div className="absolute inset-0 -z-10 bg-black/[0.72]" aria-hidden="true" />

      <div className="relative w-full px-5 py-16 text-center">
        <p className="display text-gold leading-none text-[3.2rem] sm:text-[4.5rem] lg:text-[5rem]">
          Varanasi
        </p>
        <p className="accent text-[0.6rem] sm:text-[0.66rem] text-pale/55 mt-5">
          Indian fine dining
        </p>

        <h1 className="display mt-14 sm:mt-16 text-pale/80 text-base sm:text-lg leading-snug">
          Please choose a location
        </h1>

        {/* Two abreast from 640px up. The divider is a border rather than a
            separate element so it never appears above the first card when the
            row collapses to a column on a phone. */}
        <ul className="mt-10 sm:mt-12 mx-auto grid max-w-3xl gap-10 sm:grid-cols-2 sm:gap-0">
          {branches.map((b, i) => (
            <li
              key={b.id}
              className={i > 0 ? "sm:border-l sm:border-white/15 sm:pl-10" : "sm:pr-10"}
            >
              <Link href={`/${b.slug}`} className="group block">
                <span
                  className="display block text-gold text-[2.6rem] sm:text-[3.1rem] leading-none
                             transition-colors duration-300 group-hover:text-pale"
                >
                  {b.city}
                </span>
                <span className="mt-4 block text-sm text-pale/60 leading-relaxed">
                  {b.addressLine}
                  <br />
                  {b.postcode}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
