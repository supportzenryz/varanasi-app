/**
 * The class names for form controls.
 *
 * Not a set of Tailwind utilities. These name components defined once in
 * `src/app/globals.css`, which is where the actual appearance lives — the
 * hairline border, the gold focus halo, the drawn chevron on a dropdown, the
 * custom tick, and the tighter typesetting the admin gets automatically
 * because it renders inside `.dash`.
 *
 * WHY THIS FILE EXISTS. There were fourteen copies of
 *
 *   const field = "w-full border border-[--line] px-3.5 py-3 …"
 *
 * one at the top of nearly every page with a form in it, and they had already
 * drifted apart: the booking pages carried a background colour the voucher
 * page did not, the admin used two different vertical paddings, and none of
 * them touched <select> at all — so every dropdown on the site was drawn by
 * the operating system in a system font. Changing how a text box looks meant
 * finding fourteen files and hoping.
 *
 * Import these instead of writing the classes out, so the next change is one
 * change.
 */

/** Text inputs, dropdowns, textareas, date and time fields. */
export const field = "field";

/** The small label that sits above a field. */
export const label = "field-label";

/** Quiet explanatory text under a field. */
export const hint = "field-hint";

/** A validation message under a field. */
export const fieldError = "field-error";

/** Wraps a checkbox or radio and its text: `<label className={choice}>`. */
export const choice = "choice";

/** The text beside a checkbox or radio, inside a `.choice`. */
export const choiceText = "choice-text";
