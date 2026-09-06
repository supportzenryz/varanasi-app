/**
 * The gallery's layout: which tiles run large, in what order, and how the last
 * row is closed.
 *
 * THE BUG THIS REPLACES
 *
 * The gallery made every seventh photograph twice as wide and twice as tall
 * with `i % 7 === 0`, which is fine until the arithmetic lands one on the end.
 * Birmingham publishes sixteen photographs; one becomes the banner, leaving
 * fifteen, and 14 is divisible by seven — so the final tile was a double-width
 * double-height block sitting alone in a four-column row, with half the row and
 * two rows' worth of height left as flat black. It read as a page that had
 * failed to load rather than a grid that had run out of pictures.
 *
 * A blind modulo cannot know where the end is. This does three things instead.
 *
 * 1. WIDE TILES KEEP AWAY FROM THE END, AND FROM EACH OTHER
 *
 * A double tile leaves a two-column, two-row hole beside it that only ordinary
 * tiles can fill, so one is placed only where four ordinary tiles follow it.
 * That removes the stranded block, and stops two doubles landing close enough
 * to leave a notch neither can fill.
 *
 * 2. THE LAST TILE STRETCHES TO CLOSE WHATEVER IS LEFT
 *
 * A row only fills if the number of cells divides by the column count, and the
 * column count differs between a phone (two) and a desktop (four). Rather than
 * drop a photograph to make the sum come out — tidy arithmetic, and the client
 * a picture short — the final tile widens by exactly the shortfall, separately
 * for each layout. A gallery ending on one full-width photograph reads as a
 * deliberate finale; it is really the remainder, spent rather than left.
 *
 * 3. THE BIG SLOTS GO TO PHOTOGRAPHS THAT CAN FILL THEM
 *
 * This is the part that only showed up once the holes were gone. Leicester's
 * gallery ends on a 201px-wide thumbnail, and closing the row by stretching it
 * across all four columns turned the fix into a different eyesore: a smear
 * fourteen hundred pixels wide. Position in a list says nothing about whether
 * a file can carry the space, so `large` is passed in per photograph, and both
 * the double tiles and the stretched one are only ever given to pictures that
 * can. When the last photograph is not one of them, it swaps places with the
 * last one that is: the smallest possible change to an order the client set.
 */

export type Mosaic = {
  /** Positions to render, as indices into the caller's list. */
  order: number[];
  /** Positions in `order` that render double-width and double-height. */
  wide: Set<number>;
  /** Columns the final tile spans in the two-column layout: 1 or 2. */
  lastSpanSm: number;
  /** Columns the final tile spans in the four-column layout: 1 to 4. */
  lastSpanLg: number;
};

/** One double tile per this many photographs, where the spacing allows. */
const EVERY = 5;
/** A double is two wide and two tall, so it occupies four cells, not one. */
const WIDE_CELLS = 4;

/**
 * @param large one entry per photograph: whether it has the resolution for a
 *   slot bigger than a single tile. A caller that does not know should pass
 *   `true` — the layout is then exactly as it would be without this.
 */
export function mosaic(large: boolean[]): Mosaic {
  const count = large.length;
  const order = large.map((_, i) => i);
  const wide = new Set<number>();
  if (count <= 0) return { order, wide, lastSpanSm: 1, lastSpanLg: 1 };

  // Walk in blocks of five, taking the first photograph in each block that can
  // carry a double. Nothing within four of the end is eligible: a double there
  // has too few ordinary tiles after it to pack the space it opens up.
  for (let i = 0; i + WIDE_CELLS < count; i += EVERY) {
    for (let j = i; j < Math.min(i + EVERY, count - WIDE_CELLS); j++) {
      if (large[order[j]]) { wide.add(j); break; }
    }
  }

  const cells = count + wide.size * (WIDE_CELLS - 1);
  const shortfall = (cols: number) => (cols - (cells % cols)) % cols;
  const lastSpanSm = 1 + shortfall(2);
  const lastSpanLg = 1 + shortfall(4);

  // The stretched tile is the last one, so if it is about to be widened it had
  // better be a photograph that survives it.
  const stretched = lastSpanSm > 1 || lastSpanLg > 1;
  const end = count - 1;
  if (stretched && !large[order[end]] && !wide.has(end)) {
    for (let j = end - 1; j >= 0; j--) {
      if (large[order[j]] && !wide.has(j)) {
        [order[j], order[end]] = [order[end], order[j]];
        break;
      }
    }
  }

  return { order, wide, lastSpanSm, lastSpanLg };
}
