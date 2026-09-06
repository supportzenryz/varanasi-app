import Image from "next/image";
import { GoldFrame, OrnamentDivider } from "@/components/Ornament";

/**
 * The home page's opening screen.
 *
 * It fills the screen, and the reason that is fine now is worth writing down,
 * because it was not fine before.
 *
 * The original was 92svh carrying a kicker, a three-line heading and two
 * buttons, and the client's objection was right: at that height the first
 * screen *was* the page. Nothing below existed until you scrolled and nothing
 * on it said there was anything below. The fault was the clutter, not the
 * height — a screen that busy has to be got past, and gives you no reason to
 * think there is anywhere to get to.
 *
 * One line and a scroll cue changes what the same height means: the film has
 * the whole frame, and "Explore More" is an explicit promise that the page
 * continues.
 *
 * WHY THE TYPE SITS AT THE FOOT NOW
 *
 * Centred, it landed squarely on the table in the middle of the film — the one
 * part of the shot with anything in it. The photograph is the argument on this
 * screen and the words were standing in front of it. At the foot they sit over
 * the darkest band of the gradient, which is where they are most legible and
 * where they cover least, and the eye now reads picture first, name second,
 * way-in third, top to bottom, instead of meeting all three at once.
 *
 * WHY IT IS ONE LINE, AND WHY THAT IS A CLAMP
 *
 * "Exquisite / Fine Dining" broken over two lines read as two thoughts and put
 * a ragged edge down the middle of the frame. Set on one line it is a
 * nameplate. But one line is a promise that has to hold at 320px as well as
 * 2,560px, and a stack of breakpoints cannot make that promise — there is
 * always a width between two of them where the line wraps or the type is
 * needlessly small. `clamp()` ties the size to the viewport itself, so the
 * headline is always as large as one line allows and never larger. `nowrap`
 * then makes a regression loud: if the sizing is ever wrong the text overflows
 * visibly rather than quietly wrapping back to two lines.
 */
export function HomeHero({
  image, video, city,
}: { image: string | null; video?: string | null; city: string }) {
  return (
    <section
      className="relative isolate flex min-h-[100svh] flex-col items-center justify-end overflow-hidden bg-ink text-pale"
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

      {/* Weighted to the foot, because that is where the words are now. The
          middle of the film is left almost untouched. */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(to bottom, rgba(15,15,15,.52) 0%, rgba(15,15,15,.18) 34%, rgba(15,15,15,.30) 56%, rgba(15,15,15,.82) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Clears the fixed header at the top, symmetric everywhere else. */}
      <GoldFrame
        className="top-24 bottom-5 left-5 right-5 sm:top-28 sm:bottom-8 sm:left-8 sm:right-8"
        opacity={0.6}
      />

      <div className="relative flex flex-col items-center px-6 pb-14 text-center sm:pb-16">
        <OrnamentDivider className="w-40 opacity-80 sm:w-56" />

        {/* The line above the name. It says what the kitchen thinks it is doing,
            which is the one thing a photograph of a dining room cannot. */}
        <p className="accent mt-5 text-[0.52rem] text-gold/90 min-[400px]:text-[0.58rem] sm:text-[0.66rem]">
          The artistry of Indian cooking
        </p>

        <h1
          className="display mt-4 whitespace-nowrap leading-[1.04] tracking-[0.005em] sm:mt-5"
          style={{ fontSize: "clamp(1.45rem, 6.4vw, 5.5rem)" }}
        >
          Exquisite Fine Dining
        </h1>

        {/* The cue that there is a page below this. It is a link rather than a
            flourish so that a keyboard reaches it, and it points at the band.
            In normal flow rather than absolutely positioned, so it can never
            collide with the headline at an awkward height. */}
        <a
          href="#explore"
          className="group mt-8 flex flex-col items-center gap-2 text-pale/70 transition-colors hover:text-gold sm:mt-10"
        >
          <span className="text-[0.78rem] tracking-wide">Explore More</span>
          <svg viewBox="0 0 24 14" className="h-3 w-6 animate-bounce" fill="none" aria-hidden="true">
            <path d="M2 2 L 12 11 L 22 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </a>
      </div>
    </section>
  );
}
