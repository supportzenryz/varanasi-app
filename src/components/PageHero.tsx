import Image from "next/image";

/**
 * The full-bleed banner every page opens with. Birmingham's home page plays the
 * restaurant film; everywhere else (and all of Leicester) uses a still. Both
 * cover the whole area, as they do on the live site.
 *
 * The two shapes differ on purpose:
 *
 * `full` is the home page. It is centred, it drops the standfirst, and its
 * heading is deliberately smaller than a viewport-filling banner invites — the
 * photograph is the argument there, and a wall of type competes with it. The
 * job of that screen is a name, a line, and a way in.
 *
 * The shorter page banner keeps its standfirst, because on those pages the
 * standfirst is often load-bearing: the deposit per head, which address the
 * confirmation went to, or that no table is being held. Losing it would cost
 * information, not decoration.
 */
export function PageHero({
  image, video, kicker, heading, intro, children, full = false, align = "left",
}: {
  image: string | null;
  video?: string | null;
  kicker?: string | null;
  heading: string;
  intro?: string | null;
  children?: React.ReactNode;
  /** true = fills the viewport (home page); false = a shorter page banner */
  full?: boolean;
  align?: "left" | "center";
}) {
  const centred = full || align === "center";
  return (
    <section
      className={`relative isolate bg-ink text-pale overflow-hidden ${
        full
          ? "min-h-[92svh] flex items-center"
          : "min-h-[58svh] sm:min-h-[62svh] flex items-end"
      }`}
    >
      {video ? (
        <video
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          src={video}
          poster={image ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      ) : image ? (
        <Image src={image} alt="" fill priority sizes="100vw" className="object-cover -z-20 ken-burns" />
      ) : null}

      <div className={`absolute inset-0 -z-10 ${centred ? "wash-ink-y" : "wash-ink"}`} aria-hidden="true" />

      <div className={`relative mx-auto max-w-[84rem] w-full px-5 lg:px-10 ${
        full ? "py-24 text-center" : "pb-16 sm:pb-24 pt-40"
      } ${centred && !full ? "text-center" : ""}`}>
        <div className={centred ? "mx-auto max-w-[46ch]" : "max-w-[54ch]"}>
          {kicker && (
            <p className="accent text-[0.62rem] text-gold mb-5">{kicker}</p>
          )}
          <h1
            className={
              full
                ? "text-[2rem] leading-[1.12] sm:text-[2.6rem] lg:text-[3.1rem] text-balance"
                : "text-4xl sm:text-5xl"
            }
          >
            {heading}
          </h1>

          {/* Deliberately not rendered on the home page — see the note above. */}
          {intro && !full && (
            <p className="mt-6 text-pale/75 leading-relaxed max-w-[52ch]">{intro}</p>
          )}

          {children && (
            <div className={`mt-10 flex flex-wrap gap-3 ${centred ? "justify-center" : ""}`}>
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
