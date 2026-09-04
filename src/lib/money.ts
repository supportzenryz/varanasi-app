export function formatPence(pence: number | null | undefined): string {
  if (pence == null) return "";
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}
/**
 * Reads a money amount typed by staff, or returns null if it isn't one.
 *
 * This used to strip every character it did not like and parse whatever was
 * left, which turned bad input into confident wrong numbers rather than
 * refusals: "-10", entered to reverse a redemption, came back as +£10 and took
 * another ten pounds off the guest's voucher. "14 / 18" — two measures typed
 * into one price box — came back as £1,418 and went on the live menu. "1,250"
 * became £125,000.
 *
 * So: strip spaces and a currency symbol, and then require what remains to
 * actually look like a number. Anything else is null, and the caller is
 * expected to say so rather than guess.
 */
export function parsePounds(input: string): number | null {
  const cleaned = String(input ?? "").trim().replace(/[£$€\s]/g, "").replace(/,(?=\d{3}\b)/g, "");
  if (!cleaned) return null;
  // digits, with at most one decimal point and at most two decimals. A leading
  // minus is deliberately not allowed: negative money is always a mistake here,
  // and reversing a redemption is a different operation, not a negative one.
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
export const DIETARY_LABELS: Record<string, string> = {
  g: "Contains gluten", d: "Contains dairy", n: "Contains nuts",
  v: "Vegetarian", vg: "Vegan", sf: "Contains shellfish", e: "Contains egg",
  gf: "Gluten free", df: "Dairy free",
};
