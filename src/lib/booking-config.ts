import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import defaults from "../../data/booking.json";

/**
 * Reservation rules. `data/booking.json` is the shipped default; the live values
 * live in the `settings` table under `booking_rules` so the restaurant can change
 * slot times, capacity and the deposit policy in the admin without a deploy.
 */
export type BookingRules = {
  slots: { first: string; last: string; intervalMinutes: number };
  capacity: { coversPerSlot: Record<string, number>; maxPartyOnline: number; minPartyOnline: number };
  leadTime: { minutesBefore: number; maxDaysAhead: number };
  deposit: {
    policy: "always" | "nights" | "off";
    perPersonPence: number;
    nights: string[];
    minParty: number;
    holdMinutes: number;
    note: string;
  };
  occasions: { options: string[] };
  allergens: { options: string[] };
  consents: { terms: string; deposit: string; depositRate: string; marketing: string };
  notifications: { to: string[]; fromName: string; fromEmail: string; replyTo: string };
  vouchers: VoucherRules;
  followUp: FollowUpRules;
  whatsapp: { enabled: boolean; templates: Record<string, string> };
  analytics: { ga4MeasurementId: string; consentRequired: boolean };
};

export type VoucherRules = {
  valuesPence: number[];
  allowCustom: boolean;
  minPence: number;
  maxPence: number;
  expiryMonths: number;
  allowBranchChoice: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  notifyTo: string[];
};

export type FollowUpRules = {
  enabled: boolean;
  delayHours: number;
  complimentaryPence: number;
  complimentaryExpiryDays: number;
  reviewUrl: Record<string, string>;
};

export const SETTINGS_KEY = "booking_rules";

export function bookingRules(): BookingRules {
  const row = db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (row?.value) {
    try {
      // shallow-merge over the defaults so a partially-saved settings row can't
      // leave the booking form without, say, an occasions list
      const saved = JSON.parse(row.value) as Partial<BookingRules>;
      return { ...(defaults as unknown as BookingRules), ...saved };
    } catch {
      /* fall through to defaults */
    }
  }
  return defaults as unknown as BookingRules;
}

/** Every bookable time for a branch, as "HH:MM", ignoring availability. */
export function allSlots(rules: BookingRules): string[] {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const out: string[] = [];
  const step = Math.max(5, rules.slots.intervalMinutes);
  for (let m = toMinutes(rules.slots.first); m <= toMinutes(rules.slots.last); m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/** "17:30" -> "5:30pm", the way the restaurant writes it. */
export function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The deposit due for a party on a date, in pence. 0 means none. */
export function depositFor(rules: BookingRules, date: string, partySize: number): number {
  const d = rules.deposit;
  if (d.policy === "off") return 0;
  if (partySize < d.minParty) return 0;
  if (d.policy === "nights") {
    const day = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    if (!d.nights.map((n) => n.toLowerCase()).includes(day)) return 0;
  }
  return d.perPersonPence * partySize;
}

export function voucherRules(): VoucherRules {
  return bookingRules().vouchers;
}
export function followUpRules(): FollowUpRules {
  return bookingRules().followUp;
}
export function whatsappRules() {
  return bookingRules().whatsapp;
}
export function analyticsRules() {
  return bookingRules().analytics;
}
