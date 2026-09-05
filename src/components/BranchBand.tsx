import { OrnamentFlourish } from "@/components/Ornament";

/**
 * The line directly under the hero.
 *
 * It is doing two jobs at once. Visually it is the lid on the photograph — the
 * thing that shows above the fold and tells you the page continues. But it is
 * also where the search terms went when the hero was cut back to "Exquisite
 * Fine Dining": this is the page's H2 and it carries the city, so
 * "Indian restaurant Leicester" still has somewhere real to match. Losing that
 * from the H1 without putting it anywhere would have quietly cost the
 * restaurant covers.
 */
export function BranchBand({ city }: { city: string }) {
  return (
    <section id="explore" className="scroll-mt-24 border-y border-gold/15 bg-ink-2">
      <div className="mx-auto flex max-w-[84rem] items-center justify-center gap-6 px-5 py-9 sm:gap-10 lg:px-10">
        <OrnamentFlourish className="hidden sm:block" />
        <h2 className="text-center text-xl leading-snug sm:text-2xl lg:text-[1.75rem]">
          {city}&rsquo;s Best Fine Dining Indian Restaurant
        </h2>
        <OrnamentFlourish className="hidden sm:block" flip />
      </div>
    </section>
  );
}
