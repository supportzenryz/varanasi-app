import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { branchBySlug, telHref } from "@/lib/branches";
import { branchMedia } from "@/lib/brand";
import { bookingRules } from "@/lib/booking-config";
import { pageHref } from "@/lib/nav";
import { PageHero } from "@/components/PageHero";
import { EnquiryForm } from "@/components/EnquiryForm";
import { Sent } from "@/components/Sent";

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = branchBySlug(slug);
  if (!b) return {};
  return {
    title: "Catering",
    description: `Catering enquiries for Varanasi ${b.city} — tell us about your event and our team will come back to you.`,
    alternates: { canonical: `/${b.slug}/catering` },
  };
}

/**
 * The old site's catering page was never published — it exists in the WordPress
 * export as a draft with no body copy. Rather than invent marketing copy for a
 * service whose terms we don't know, this is an honest enquiry page. The client
 * supplies the words and we drop them in.
 */
export default async function Catering({
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
  const rules = bookingRules();

  return (
    <>
      <PageHero
        image={media.menuHero}
        kicker="Catering"
        heading="Catering enquiries"
        intro="Our kitchen off-site, for events of any size. Tell us what you have in mind."
      />

      <section className="bg-ink">
        <div className="mx-auto max-w-[58rem] px-5 lg:px-10 py-14 sm:py-20">
          <div className="max-w-[62ch] text-pale/75 leading-relaxed grid gap-6">
            <p>
              The same kitchen that runs our dining rooms can cater your event — from a family
              celebration at home to a corporate gathering. Every enquiry is quoted individually, because
              menus, numbers and service all change what&rsquo;s possible.
            </p>
            <p>
              Send us the details below and our team will come back to you with options. If it&rsquo;s
              urgent, call us on{" "}
              <a href={telHref(branch.phone)} className="underline hover:text-gold tnum">{branch.phone}</a>.
            </p>
          </div>

          <div className="mt-12 border border-[--line] bg-ink-2 px-5 sm:px-8 py-8">
            <Sent sent={sent === "1"} error={error} />
            <EnquiryForm
              type="catering"
              branchSlug={branch.slug}
              returnTo={`/${branch.slug}/catering`}
              fields={["phone", "company", "partySize", "date", "time", "dietary"]}
              occasions={rules.occasions.options}
              heading="Tell us about your event"
              privacyHref={`/${branch.slug}/privacy`}
              messageLabel="About your event"
              messagePlaceholder="Where it's being held, how many guests, what kind of service you'd like…"
            />
          </div>

          <p className="mt-10 text-sm text-pale/70">
            Looking for a private room in the restaurant instead?{" "}
            <Link href={pageHref(branch.slug, "private-dining-experiences")} className="underline hover:text-gold">
              See our private dining spaces
            </Link>.
          </p>
        </div>
      </section>
    </>
  );
}
