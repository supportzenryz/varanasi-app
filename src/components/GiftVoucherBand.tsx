import Link from "next/link";
import Image from "next/image";
import { brand } from "@/lib/brand";
import { pageHref } from "@/lib/nav";

/** The gift voucher band that closes every page on the live site. */
export function GiftVoucherBand({ branchSlug }: { branchSlug: string }) {
  return (
    <section className="relative isolate bg-ink text-pale">
      <Image src={brand.giftVoucherImage} alt="" fill sizes="100vw"
        className="object-cover -z-20 opacity-30" />
      <div className="absolute inset-0 -z-10 bg-ink/70" aria-hidden="true" />
      <div className="relative mx-auto max-w-[84rem] px-5 lg:px-10 py-20 sm:py-24 text-center">
        <p className="accent text-[0.62rem] text-gold">Gift Vouchers</p>
        <h2 className="text-3xl sm:text-4xl mt-4">Give the taste of Varanasi</h2>
        <p className="mt-5 text-pale/75 max-w-[46ch] mx-auto leading-relaxed">
          Treat your family, friends or colleagues to a dining experience at Varanasi.
        </p>
        <Link href={pageHref(branchSlug, "gift-vouchers")} className="btn btn-gold mt-9">
          Buy gift vouchers
        </Link>
      </div>
    </section>
  );
}
