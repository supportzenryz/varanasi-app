/**
 * Decorative marks, drawn for this restaurant.
 *
 * The old site's ornaments were yootheme theme assets and are not in the
 * export — the 620 files those pages referenced are all missing — so these are
 * new work rather than a copy. The vocabulary is drawn from the same place the
 * restaurant's name is: the lotus, and the pierced stone jali screens of North
 * Indian architecture.
 *
 * They are deliberately spare. At a fine-dining price point ornament reads as
 * confidence only while it stays quiet; the moment it gets busy it reads as a
 * takeaway menu. Everything here is a single hairline weight in the gold
 * already in the palette, and every piece is aria-hidden — none of it carries
 * meaning a reader would miss.
 */

/** One lotus petal, rising from the origin. Rotated copies make the flower. */
const PETAL = "M0 0 C 3.1 -3.6, 3.1 -7.6, 0 -11 C -3.1 -7.6, -3.1 -3.6, 0 0 Z";

/**
 * A section divider: a lotus at the centre, with rules tapering away from it.
 * Replaces the ◆ that stood in for this.
 */
export function OrnamentDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 text-gold ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-[linear-gradient(to_right,transparent,currentColor)] opacity-40" />
      <svg viewBox="0 0 44 24" className="h-6 w-11 shrink-0 overflow-visible" fill="none">
        <g transform="translate(22 17)" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round">
          <path d={PETAL} opacity="0.9" />
          <path d={PETAL} transform="rotate(-32)" opacity="0.7" />
          <path d={PETAL} transform="rotate(32)" opacity="0.7" />
          <path d={PETAL} transform="rotate(-62)" opacity="0.45" />
          <path d={PETAL} transform="rotate(62)" opacity="0.45" />
        </g>
        <circle cx="22" cy="18.5" r="1.15" fill="currentColor" />
      </svg>
      <span className="h-px flex-1 bg-[linear-gradient(to_left,transparent,currentColor)] opacity-40" />
    </div>
  );
}

/**
 * A jali band — the pierced-lattice screen, reduced to its repeating unit.
 * Used as a hairline edge above a section, where a plain border would do the
 * same job with none of the character.
 */
export function JaliBand({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`w-full h-3 text-gold ${className}`}
      viewBox="0 0 96 12"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id="jali" width="24" height="12" patternUnits="userSpaceOnUse">
          {/* A pointed arch with a lobe either side: the unit a jali repeats. */}
          <path
            d="M0 12 C 0 5, 5 1, 12 1 C 19 1, 24 5, 24 12"
            stroke="currentColor"
            strokeWidth="0.7"
            opacity="0.55"
          />
          <path d="M12 1 V 12" stroke="currentColor" strokeWidth="0.5" opacity="0.28" />
          <circle cx="12" cy="4.6" r="1.05" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
        </pattern>
      </defs>
      <rect width="96" height="12" fill="url(#jali)" />
    </svg>
  );
}

/**
 * A corner filigree, for framing a photograph. Four rotated copies make the
 * frame; each is a quarter-arch with a small lotus bud at the turn.
 */
export function OrnamentCorner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={`h-7 w-7 text-gold ${className}`} fill="none" aria-hidden="true">
      <path d="M27 1 H 8 C 4.1 1, 1 4.1, 1 8 V 27" stroke="currentColor" strokeWidth="0.9" opacity="0.75" />
      <path d="M27 5 H 9.5 C 6.9 5, 5 6.9, 5 9.5 V 27" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
      <circle cx="8.4" cy="8.4" r="1.5" stroke="currentColor" strokeWidth="0.7" opacity="0.7" />
    </svg>
  );
}
