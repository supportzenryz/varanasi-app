import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { allBranches } from "@/lib/branches";
import { brand } from "@/lib/brand";
import { OrnamentDivider } from "@/components/Ornament";
import { organisationJsonLd } from "@/lib/seo";

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
 * It carries the drawn wordmark rather than the name set in a typeface. They
 * are not the same thing: the wordmark has the restaurant's own letterforms —
 * the flared serifs, the tight A — and setting "Varanasi" in the site's
 * display face is an approximation of it that lands a few pixels off in a
 * dozen places. On the page where the brand is the entire content, the
 * approximation is the wrong choice.
 *
 * Two lines came off this page: "Indian fine dining" and "Please choose a
 * location". The first is now carried in the wordmark's alternative text and
 * the metadata, where the search engines that wanted it can still read it,
 * without a subtitle sitting under a logo that already says it. The second was
 * an instruction for something the page makes obvious — two cities, side by
 * side, nothing else on the screen — and reading like an interface prompt is
 * the opposite of what this screen is for.
 *
 * What replaced them is decoration with a job: a lotus divider and one line of
 * italic. It marks the two restaurants as the thing to look at, and it sounds
 * like the front of house rather than a form.
 *
 * The two restaurants sit side by side rather than stacked: they are a choice
 * between equals, and a column implies a first and a second. Each carries its
 * street address, because a visitor deciding between Birmingham and Leicester
 * is usually deciding on geography.
 */
export default function ChooseBranch() {
  const branches = allBranches();

  return (
    <>
      {/* The two restaurants as one business, for the front door.
          Each branch page carries its own Restaurant markup; this is what
          tells Google they belong to the same organisation rather than being
          two unrelated places that happen to share a name — which is the
          confusion the client asked us to fix in the first place. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: organisationJsonLd(branches) }}
      />
    <main className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-ink">
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
        {/* The wordmark is the heading. Its alt text is the accessible name of
            the h1, so a screen reader hears the restaurant and what it does —
            which is why the words dropped from the screen are not lost. */}
        <h1 className="mx-auto w-[min(78vw,26rem)]">
          <Image
            src={brand.wordmark}
            alt="Varanasi — Indian fine dining"
            width={341}
            height={49}
            priority
            quality={95}
            className="h-auto w-full"
          />
        </h1>

        <OrnamentDivider className="mx-auto mt-14 w-[min(64vw,20rem)] opacity-80 sm:mt-16" />
        <p className="display mt-6 text-lg italic text-gold/90 sm:text-xl">
          Where shall we seat you?
        </p>

        {/* Two abreast from 640px up. The divider is a border rather than a
            separate element so it never appears above the first card when the
            row collapses to a column on a phone. */}
        <ul className="mt-11 sm:mt-12 mx-auto grid max-w-3xl gap-10 sm:grid-cols-2 sm:gap-0">
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
    </>
  );
}
