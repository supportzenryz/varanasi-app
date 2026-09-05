import Image from "next/image";
import { GoldFrame } from "@/components/Ornament";

/**
 * The home page's opening screen.
 *
 * It was 92svh of photograph carrying a kicker, a three-line heading and two
 * buttons — and the client's objection was the right one: at that height the
 * first screen *is* the page. Nothing below it exists until you scroll, and
 * nothing on it tells you there is anything below.
 *
 * So this is shorter than a full viewport on purpose. The band underneath
 * shows above the fold on a laptop, which is what turns "a photograph" into
 * "the top of a page". And the type is now one line, because a line that short
 * can be set large enough to be an image in its own right — the previous
 * heading had to shrink to fit and ended up neither picture nor statement.
 *
 * The buttons are gone at the client's request. Reserving is one tap away in
 * the header on every screen, so the hero was repeating a control rather than
 * providing one; what it gains is silence.
 */
export function HomeHero({
  image, video, city,
}: { image: string | null; video?: string | null; city: string }) {
  return (
    <section
      className="relative isolate flex min-h-[78svh] items-center justify-center overflow-hidden bg-ink text-pale sm:min-h-[82svh]"
      aria-label={`Varanasi ${city}`}
    >
      {video ? (
        <video
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          src={video}
          poster={image ?? undefined}
          autoPlay muted loop playsInline preload="metadata" aria-hidden="true"
        />
      ) : image ? (
        <Image src={image} alt="" fill priority sizes="100vw" className="ken-burns -z-20 object-cover" />
      ) : null}

      {/* Darker at the foot than the old wash, so the frame and the scroll cue
          hold against a bright photograph without dimming the middle. */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(to bottom, rgba(15,15,15,.55) 0%, rgba(15,15,15,.28) 38%, rgba(15,15,15,.72) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Clears the fixed header at the top, symmetric everywhere else. */}
      <GoldFrame
        className="top-24 bottom-5 left-5 right-5 sm:top-28 sm:bottom-8 sm:left-8 sm:right-8"
        opacity={0.6}
      />

      <h1 className="display px-6 text-center text-[2.6rem] leading-[1.05] tracking-[0.01em] sm:text-[4rem] lg:text-[5.25rem]">
        Exquisite
        <span className="block">Fine Dining</span>
      </h1>

      {/* The cue that there is a page below this. It is a link rather than a
          flourish so that a keyboard reaches it, and it points at the band. */}
      <a
        href="#explore"
        className="group absolute bottom-9 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-pale/70 transition-colors hover:text-gold"
      >
        <span className="text-[0.78rem] tracking-wide">Explore More</span>
        <svg viewBox="0 0 24 14" className="h-3 w-6 animate-bounce" fill="none" aria-hidden="true">
          <path d="M2 2 L 12 11 L 22 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </a>
    </section>
  );
}
