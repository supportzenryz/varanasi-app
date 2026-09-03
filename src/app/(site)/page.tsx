import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { allBranches } from "@/lib/branches";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Varanasi | Indian Fine Dining",
  description:
    "Indian fine dining in Birmingham and Leicester. Choose your restaurant to see menus, book a table or buy a gift voucher.",
  alternates: { canonical: "/" },
  openGraph: { images: [brand.socialImage] },
};

/**
 * The branch chooser, matching the live varanasi.uk front door: the Buddha
 * corridor photograph full-bleed, a 69% black wash over it, and the logo,
 * prompt and two city names centred in the viewport.
 *
 * The hero photograph is committed to the repo rather than imported like the
 * rest of the media, because it belongs to the root site and isn't in either
 * branch's media library — same reasoning as the theme fonts.
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
      <div className="absolute inset-0 -z-10 bg-black/[0.69]" aria-hidden="true" />

      {/* Sizes and gaps below are measured off the live page, not guessed:
          logo ~500px wide, prompt ~22px, city names ~56px, and the block sits
          a little above true centre, as it does on varanasi.uk. */}
      <div className="relative w-full px-5 py-16 text-center -translate-y-[6svh]">
        {/* The Buddha mark and wordmark are one asset, drawn at 520×104. Held at
            a generous width so the Buddha reads as the Buddha rather than a
            smudge beside the type — it is the restaurant's signature. */}
        <Image
          src={brand.logo}
          alt="Varanasi"
          width={1040}
          height={208}
          priority
          quality={95}
          sizes="(min-width: 640px) 40rem, 88vw"
          className="mx-auto h-auto w-[min(40rem,88vw)]"
        />

        <h1 className="display mt-10 sm:mt-12 text-pale text-xl sm:text-[1.6rem] leading-snug">
          Please choose a location below:
        </h1>

        <ul className="mt-16 sm:mt-24 grid gap-14 sm:gap-[5.4rem]">
          {branches.map((b) => (
            <li key={b.id}>
              <Link
                href={`/${b.slug}`}
                className="display inline-block text-gold text-[2.9rem] sm:text-[4rem] leading-none
                           transition-colors duration-300 hover:text-pale"
              >
                {b.city}
                <span className="sr-only"> — Varanasi {b.city}, {b.addressLine}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
