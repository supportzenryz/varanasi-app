export function formatPence(pence: number | null | undefined): string {
  if (pence == null) return "";
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}
export function parsePounds(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export const DIETARY_LABELS: Record<string, string> = {
  g: "Contains gluten", d: "Contains dairy", n: "Contains nuts",
  v: "Vegetarian", vg: "Vegan", sf: "Contains shellfish", e: "Contains egg",
  gf: "Gluten free", df: "Dairy free",
};
