import "server-only";
import { and, eq, gte, inArray, gt, lte, or, isNull } from "drizzle-orm";
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

/* ------------------------------------------------ the calendar ------------ */

export type DayState = "open" | "past" | "closed" | "blocked" | "full" | "soon" | "far";

export type CalendarDay = {
  date: string;              // yyyy-mm-dd
  state: DayState;
  /** why it can't be booked, in words a guest should read */
  reason?: string;
  /** how many of the day's sittings are still free — drives the "few left" hint */
  free: number;
};

/**
 * Every day's status for the date picker, in two queries rather than 180.
 *
 * The native <input type="date"> could not do this. It renders the browser's
 * own calendar — a light-grey box on a black page, in whatever date order the
 * operating system fancies — and, more to the point, it has no idea which days
 * the restaurant is shut. A guest picked Christmas Day, pressed Update, and
 * only then learned it was blocked. If the restaurant takes a wedding for a
 * Saturday, every guest who wants that Saturday finds out one at a time, after
 * choosing it.
 *
 * `availabilityFor` answers this properly for a single day but goes to the
 * database twice each time, so calling it 180 times to draw a calendar is 360
 * queries per page view. This does the same work with one pass over the blocks
 * and one over the bookings, then applies the same rules in memory. The rules
 * live in one place — if they drift, the day the guest picks and the day the
 * booking accepts disagree, which is the worst possible bug in this flow.
 */
export function calendarFor(
  branch: Branch,
  partySize: number,
  days = 90,
  rules: BookingRules = bookingRules(),
): CalendarDay[] {
  const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const from = todayISO;
  const to = addDays(todayISO, days);

  const blocks = db.select().from(blockedDates)
    .where(and(
      eq(blockedDates.branchId, branch.id),
      gte(blockedDates.date, from),
      lte(blockedDates.date, to),
    )).all().filter((b) => b.roomId == null);

  const booked = db.select({ date: bookings.date, time: bookings.time, partySize: bookings.partySize })
    .from(bookings)
    .where(and(
      eq(bookings.branchId, branch.id),
      gte(bookings.date, from),
      lte(bookings.date, to),
      inArray(bookings.status, ["held", "confirmed", "seated"]),
      or(
        inArray(bookings.status, ["confirmed", "seated"]),
        isNull(bookings.holdExpiresAt),
        gt(bookings.holdExpiresAt, nowSeconds()),
      ),
    )).all();

  const committed = new Map<string, number>();          // "date time" -> covers
  for (const r of booked) {
    const k = `${r.date} ${r.time}`;
    committed.set(k, (committed.get(k) ?? 0) + r.partySize);
  }

  const hours = openingHours(branch);
  const times = allSlots(rules);
  const covers = rules.capacity.coversPerSlot[branch.slug] ?? 30;
  const cutoff = Date.now() + rules.leadTime.minutesBefore * 60_000;

  const out: CalendarDay[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(todayISO, i);

    if (i > rules.leadTime.maxDaysAhead) {
      out.push({ date, state: "far", free: 0, reason: "Beyond the booking window" });
      continue;
    }

    const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const open = hours.find((h) => h.day.toLowerCase().startsWith(weekday.slice(0, 3).toLowerCase()));
    if (open?.closed) {
      out.push({ date, state: "closed", free: 0, reason: `Closed on ${weekday}s` });
      continue;
    }

    const dayBlocks = blocks.filter((b) => b.date === date);
    const whole = dayBlocks.find((b) => b.allDay);
    if (whole) {
      /* The reason the manager typed is shown to the guest. That is deliberate
         — "Private event" or "Christmas Day" tells them to try another date and
         not to ring; a bare "unavailable" makes them ring. */
      out.push({ date, state: "blocked", free: 0, reason: whole.reason || "Not taking bookings" });
      continue;
    }

    let free = 0;
    let anyRoom = false;
    for (const time of times) {
      const remaining = Math.max(0, covers - (committed.get(`${date} ${time}`) ?? 0));
      if (remaining >= partySize) anyRoom = true;
      const inBlock = dayBlocks.some((b) =>
        !b.allDay && b.fromTime && b.toTime && time >= b.fromTime && time < b.toTime);
      const tooSoon = new Date(`${date}T${time}:00`).getTime() < cutoff;
      if (!inBlock && !tooSoon && remaining >= partySize) free++;
    }

    if (free > 0) out.push({ date, state: "open", free });
    else if (anyRoom) {
      /* Room in the room, but every sitting has passed — which is only ever
         true of today, and is a different sentence from "fully booked". */
      out.push({ date, state: "soon", free: 0, reason: "Tonight's sittings have passed" });
    } else {
      out.push({
        date, state: "full", free: 0,
        reason: `Fully booked for ${partySize} ${partySize === 1 ? "guest" : "guests"}`,
      });
    }
  }
  return out;
}

/** The first day a guest could actually book, or null if there is none in range. */
export function nextOpenDay(calendar: CalendarDay[], notBefore?: string): CalendarDay | undefined {
  return calendar.find((d) => d.state === "open" && (!notBefore || d.date >= notBefore));
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
