import Link from "next/link";
import Image from "next/image";
import { GoldFrame } from "@/components/Ornament";

export type Stack = { label: string; href: string; image: string };

/**
 * The four menus, as tall panels.
 *
 * Modelled on the old site's stacked columns, which were the one piece of that
 * design worth keeping: they gave the menus presence without making the home
 * page into a menu. A list of links would carry the same information and none
 * of the appetite.
 *
 * TWO THINGS THAT ARE NOT DECORATION HERE.
 *
 * The labels run vertically only from `lg` up. Rotated text in a 90px column
 * on a phone is a party trick that costs legibility, so below that the panels
 * become a two-by-two grid with the labels the right way up. The old site did
 * not do this and its menu columns were unreadable on a handset — which is
 * where most people meet a restaurant.
 *
 * And each panel is a real link to a real menu, not a lightbox: someone who
 * wants the vegetarian set menu gets it in one tap, and it is a page they can
 * send to the person they are booking for.
 */
export function MenuStacks({ stacks }: { stacks: Stack[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {stacks.map((s) => (
        <Link
          key={s.label}
          href={s.href}
          className="group relative isolate flex overflow-hidden bg-ink
                     h-56 sm:h-72 lg:h-[30rem]
                     items-end justify-center lg:items-center"
        >
          <Image
            src={s.image}
            alt=""
            fill
            sizes="(max-width: 1024px) 50vw, 25vw"
            className="-z-20 object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]"
          />
          <div
            className="absolute inset-0 -z-10 transition-opacity duration-500 group-hover:opacity-80"
            style={{
              background:
                "linear-gradient(to top, rgba(15,15,15,.88) 0%, rgba(15,15,15,.35) 55%, rgba(15,15,15,.5) 100%)",
            }}
            aria-hidden="true"
          />

          <GoldFrame className="inset-2.5" opacity={0.45} />

          <span
            className="display relative px-4 pb-8 text-center text-lg leading-tight text-pale
                       transition-colors group-hover:text-gold
                       lg:pb-0 lg:text-2xl lg:[writing-mode:vertical-rl] lg:rotate-180"
          >
            {s.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
