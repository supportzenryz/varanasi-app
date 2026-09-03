import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { PageHero } from "@/components/PageHero";
import { EnquiryForm } from "@/components/EnquiryForm";
import { Sent } from "@/components/Sent";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Franchise Opportunities",
    description: "Varanasi is looking to partner with experienced restaurant operators who share our passion and energy.",
    alternates: { canonical: `/${b.slug}/franchise-opportunities` },
  };
}

/** The three criteria from the live page, verbatim. */
const CRITERIA = [
  "Be an experienced restaurant operator in your own territory.",
  "Have the financial resources to roll out and support the restaurants and brand across the territory, with sufficiently available funds.",
  "Have an established foundation that can provide support functions to your Indian restaurant.",
];

export default async function Franchise({
  params, searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { branch: slug } = await params;
  const branch = branchBySlug(slug);
  if (!branch) notFound();
  const media = branchMedia(branch.slug);
  const { sent, error } = await searchParams;

  return (
    <>
      <PageHero
        image={media.menuHero}
        kicker="Franchise"
        heading="Franchise Opportunities"
        intro="We're looking to partner with individuals who share our passion and energy."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[70rem] px-5 lg:px-10 py-14 sm:py-20 grid gap-14 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-2xl sm:text-3xl">What we are looking for in a franchise partner</h2>
            <p className="mt-6 text-pale/75 leading-relaxed max-w-[62ch]">
              We&rsquo;re looking to partner with individuals who share our passion and energy. You should
              care as much as we do about sourcing the best ingredients and providing dedicated service
              and most importantly, making your restaurant the best it can be.
            </p>
            <p className="mt-6 text-pale/75 leading-relaxed max-w-[62ch]">
              As well as establishing a positive and productive relationship with us, you should also:
            </p>
            <ul className="mt-6 grid gap-4">
              {CRITERIA.map((c, i) => (
                <li key={c} className="flex gap-4">
                  <span className="accent text-[0.7rem] text-gold shrink-0 pt-1 tnum">0{i + 1}</span>
                  <span className="text-pale/75 leading-relaxed">{c}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10 border-l-2 border-gold bg-gold/8 px-5 py-5">
              <h3 className="text-xl">Talk to Us!</h3>
              <p className="text-sm text-pale/75 mt-2 leading-relaxed">
                If you think you fit the bill and that we could work together, we&rsquo;d love you to
                contact us. We look forward to hearing from you.
              </p>
            </div>
          </div>

          <div className="border border-[--line] bg-ink-2 px-5 sm:px-8 py-8">
            <Sent sent={sent === "1"} error={error} />
            <EnquiryForm
              type="franchise"
              branchSlug={null}
              returnTo={`/${branch.slug}/franchise-opportunities`}
              fields={["phone", "company", "location"]}
              heading="Enquiry form"
              privacyHref={`/${branch.slug}/privacy`}
              submitLabel="Send message"
              messageLabel="Tell us about yourself"
              messagePlaceholder="Your experience, the territory you have in mind, and your funding position."
            />
          </div>
        </div>
      </section>
    </>
  );
}
