import "server-only";
import { and, eq, inArray, gt, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bookings, blockedDates } from "@/db/schema";
import type { Branch } from "@/lib/branches";
import { openingHours } from "@/lib/branches";
import { allSlots, bookingRules, depositFor, type BookingRules } from "@/lib/booking-config";

export type Slot = {
  time: string;          // "19:30"
  available: boolean;
  remaining: number;     // covers still free in this slot
};

export type DayAvailability = {
  date: string;
  slots: Slot[];
  /** set when the whole day is unbookable, with the reason to show the guest */
  closed?: string;
  depositPence: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Covers already committed per slot: confirmed bookings, plus holds still alive. */
function committedCovers(branchId: number, date: string): Map<string, number> {
  const rows = db.select({ time: bookings.time, partySize: bookings.partySize })
    .from(bookings)
    .where(and(
      eq(bookings.branchId, branchId),
      eq(bookings.date, date),
      // anything that still occupies a table
      inArray(bookings.status, ["held", "confirmed", "seated"]),
      // ...but a `held` booking whose payment window has passed no longer does
      or(
        inArray(bookings.status, ["confirmed", "seated"]),
        isNull(bookings.holdExpiresAt),
        gt(bookings.holdExpiresAt, nowSeconds()),
      ),
    ))
    .all();

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.time, (map.get(r.time) ?? 0) + r.partySize);
  return map;
}

/**
 * What a guest can actually book, for one branch on one date.
 *
 * Everything the old enquiry form ignored is enforced here: the branch's own
 * opening hours, dates the manager has blocked, how many covers the kitchen
 * will take in a slot, how close to the sitting we still accept a booking, and
 * the party-size ceiling above which the restaurant wants a phone call.
 */
export function availabilityFor(
  branch: Branch,
  date: string,
  partySize: number,
  rules: BookingRules = bookingRules(),
): DayAvailability {
  const deposit = depositFor(rules, date, partySize);
  const blank = (closed: string): DayAvailability =>
    ({ date, slots: [], closed, depositPence: deposit });

  // --- party size ---
  if (partySize > rules.capacity.maxPartyOnline) {
    return blank(`For parties of more than ${rules.capacity.maxPartyOnline}, please call us on ${branch.phone} — we'll look after you personally.`);
  }
  if (partySize < rules.capacity.minPartyOnline) return blank("Please choose how many guests are coming.");

  // --- date sanity ---
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return blank("Please choose a date.");
  const dayStart = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dayStart.getTime())) return blank("Please choose a date.");

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  if (date < todayISO) return blank("That date has already passed.");

  const daysAhead = Math.round((dayStart.getTime() - new Date(`${todayISO}T00:00:00Z`).getTime()) / 86_400_000);
  if (daysAhead > rules.leadTime.maxDaysAhead) {
    return blank(`We take bookings up to ${Math.floor(rules.leadTime.maxDaysAhead / 30)} months ahead. Please choose an earlier date.`);
  }

  // --- the branch's own opening hours ---
  const weekday = WEEKDAYS[dayStart.getUTCDay()];
  const hours = openingHours(branch).find((h) => h.day.toLowerCase().startsWith(weekday.slice(0, 3).toLowerCase()));
  if (hours?.closed) return blank(`We're closed on ${weekday}s. Please choose another date.`);

  // --- dates the manager has blocked (whole-branch blocks only; room blocks
  //     don't affect a normal table booking) ---
  const blocks = db.select().from(blockedDates)
    .where(and(eq(blockedDates.branchId, branch.id), eq(blockedDates.date, date)))
    .all()
    .filter((b) => b.roomId == null);
  const wholeDayBlock = blocks.find((b) => b.allDay);
  if (wholeDayBlock) {
    return blank(wholeDayBlock.reason
      ? `We're not taking bookings on this date (${wholeDayBlock.reason}). Please choose another.`
      : "We're not taking bookings on this date. Please choose another.");
  }

  // --- slots ---
  const covers = rules.capacity.coversPerSlot[branch.slug] ?? 30;
  const committed = committedCovers(branch.id, date);
  const cutoff = Date.now() + rules.leadTime.minutesBefore * 60_000;

  const slots: Slot[] = allSlots(rules).map((time) => {
    const remaining = Math.max(0, covers - (committed.get(time) ?? 0));

    // inside a timed block?
    const blocked = blocks.some((b) =>
      !b.allDay && b.fromTime && b.toTime && time >= b.fromTime && time < b.toTime);

    // too close to the sitting? (only bites for today and, over midnight, tomorrow)
    const slotAt = new Date(`${date}T${time}:00`).getTime();
    const tooSoon = slotAt < cutoff;

    return { time, remaining, available: !blocked && !tooSoon && remaining >= partySize };
  });

  if (slots.every((s) => !s.available)) {
    const anyRoom = slots.some((s) => s.remaining >= partySize);
    return {
      date, slots, depositPence: deposit,
      closed: anyRoom
        ? "There's no time left to book for today. Please choose another date, or call us."
        : `We're fully booked for ${partySize} ${partySize === 1 ? "guest" : "guests"} on this date. Please try another.`,
    };
  }

  return { date, slots, depositPence: deposit };
}

/** Re-check one slot at the moment of booking, so two guests can't take the last table. */
export function slotStillAvailable(branch: Branch, date: string, time: string, partySize: number): boolean {
  const a = availabilityFor(branch, date, partySize);
  if (a.closed && a.slots.length === 0) return false;
  return a.slots.some((s) => s.time === time && s.available);
}
