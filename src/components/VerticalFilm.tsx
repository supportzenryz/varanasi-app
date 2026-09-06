"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GoldFrame, OrnamentDivider } from "@/components/Ornament";

/**
 * Whether the reader has asked their system for less movement.
 *
 * Read through `useSyncExternalStore` rather than an effect that calls
 * setState: the server has no media queries, so the server snapshot is `false`,
 * React reconciles the real answer during hydration, and there is no flash of
 * a playing video for someone who asked for stillness — and no second render
 * pass to get there.
 */
const QUERY = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * The short food film, shown at the shape it was shot in.
 *
 * WHY IT IS NOT FULL BLEED
 *
 * This footage is 360 × 640 — filmed on a phone, held upright, for social. The
 * obvious thing to do with a video on a restaurant site is stretch it across
 * the page, and doing that here would blow 360 pixels across 1,400 and turn a
 * pretty shot of a table into mush. Held at its own width it is sharp, and a
 * tall frame among wide ones is a change of rhythm rather than a mistake.
 *
 * WHY THERE IS A PAUSE BUTTON
 *
 * It loops, it starts on its own, and it runs for half a minute, which is the
 * exact case WCAG 2.2.2 covers: anything that moves by itself for more than
 * five seconds needs a way to stop it. Movement in the corner of the eye is
 * also simply hard to read past, and there is a menu next to this.
 * `prefers-reduced-motion` is honoured by leaving it paused from the start
 * rather than starting and stopping, which would be the jolt the setting asks
 * us to avoid.
 */
export function VerticalFilm({
  src, poster, kicker, heading, body, children,
}: {
  src: string;
  poster?: string;
  kicker: string;
  heading: string;
  body: string;
  children?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const quiet = useReducedMotion();
  // null means "whatever the system setting says". Once someone presses the
  // button their choice wins, which is the point of the button.
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !quiet;

  // Pushing React's decision out to the video element — synchronising an
  // external system, which is what an effect is actually for.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) void v.play().catch(() => {});   // a browser may refuse; not our business
    else v.pause();
  }, [playing]);

  return (
    <section className="reveal border-y border-white/5 bg-ink-2">
      {/* Narrower than the site's usual 84rem. A 20rem film and a 52ch column
          do not fill 1,344px, and stretched across it they sat against the left
          edge with a third of the band empty — the same hole the gallery had,
          in a different shape. Holding the pair to their own width centres them
          instead. */}
      <div className="mx-auto grid max-w-[68rem] items-center gap-12 px-5 py-20 lg:grid-cols-[auto_1fr] lg:gap-16 lg:px-10 sm:py-24">
        <div className="relative mx-auto w-[min(78vw,20rem)]">
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            muted loop playsInline preload="metadata"
            aria-label={heading}
            className="aspect-[9/16] w-full bg-ink object-cover"
          />
          <GoldFrame className="-inset-3" opacity={0.55} />
          <button
            type="button"
            onClick={() => setChoice(!playing)}
            className="absolute bottom-3 right-3 border border-white/25 bg-ink/70 px-3 py-1.5 text-xs
                       text-pale/85 transition-colors hover:border-gold hover:text-gold"
          >
            {playing ? "Pause" : "Play"}
          </button>
        </div>

        <div className="max-w-[52ch]">
          <p className="accent text-[0.62rem] text-gold">{kicker}</p>
          <h2 className="mt-4 text-3xl leading-tight sm:text-[2.5rem]">{heading}</h2>
          <OrnamentDivider className="my-7 max-w-sm" />
          <p className="leading-relaxed text-pale/70">{body}</p>
          {children && <div className="mt-9 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}
