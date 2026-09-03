import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";

export type Branch = typeof branches.$inferSelect;

export function allBranches(): Branch[] {
  return db.select().from(branches).where(eq(branches.isPublished, true)).orderBy(asc(branches.sort)).all();
}
export function branchBySlug(slug: string): Branch | undefined {
  return db.select().from(branches).where(eq(branches.slug, slug)).get();
}
export type OpeningHour = { day: string; open: string; close: string; closed?: boolean };
export function openingHours(b: Branch): OpeningHour[] {
  try { return JSON.parse(b.openingHours ?? "[]") as OpeningHour[]; } catch { return []; }
}
export const telHref = (phone: string) => `tel:${phone.replace(/\s/g, "")}`;
