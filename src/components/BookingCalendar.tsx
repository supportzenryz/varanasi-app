"use client";
import { useMemo, useState } from "react";
import type { CalendarDay } from "@/lib/availability";

/**
 * The date picker for a reservation.
 *
 * It replaces `<input type="date">`, which was wrong here for two separate
 * reasons. The cosmetic one: it renders the operating system's own calendar —
 * a pale grey panel on a black page, showing "05-09-2026" in whatever order
 * the machine is set to. The real one: it cannot know anything. Every day
 * looked identical and bookable, so a guest chose Christmas Day, or the
 * Saturday the restaurant had taken a wedding on, pressed Update, and only
 * then found out. If a manager blocks a date for a large party, every guest
 * who wanted that date discovers it one at a time, after committing to it.
 *
 * So the calendar is drawn here, from the same rules the booking itself
 * enforces: a day the restaurant is closed, blocked, fully booked for this
 * party size, or already past looks different and cannot be pressed, and says
 * why when you hover or focus it.
 *
 * It is a client component because month paging has to be instant — a page
 * load per month, in a flow that already takes three, is worse than the native
 * control it replaces. Everything it needs arrives as props, already computed
 * on the server; there is no fetching here.
 */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTH = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

/** Monday-first column for a date, 0–6. The UK reads a week that way. */
function column(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function BookingCalendar({
  days, selected, hrefPrefix, name = "date",
}: {
  days: CalendarDay[];
  selected: string | null;
  /** The URL each day links to, with the date appended — e.g.
   *  "/birmingham/book-online?guests=2&date=". A string rather than a
   *  function because a Server Component cannot hand a callback across the
   *  boundary, and because real hrefs mean the picker still works with no
   *  JavaScript and a chosen day can be shared or bookmarked. */
  hrefPrefix: string;
  name?: string;
}) {
  const byMonth = useMemo(() => {
    const m = new Map<string, CalendarDay[]>();
    for (const d of days) {
      const key = d.date.slice(0, 7);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(d);
    }
    return [...m.entries()];
  }, [days]);

  const startIndex = Math.max(
    0,
    byMonth.findIndex(([key]) => key === (selected ?? days[0]?.date ?? "").slice(0, 7)),
  );
  const [page, setPage] = useState(startIndex);
  const [key, month] = byMonth[Math.min(page, byMonth.length - 1)] ?? ["", []];

  const pad = month.length ? column(month[0].date) : 0;

  return (
    <div className="border border-[--line] bg-ink-2">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[--line]">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          aria-label="Previous month"
          className="px-2 py-1 text-pale/60 hover:text-gold disabled:opacity-25 disabled:hover:text-pale/60"
        >
          ‹
        </button>
        <span className="text-sm font-semibold" aria-live="polite">
          {key ? MONTH(`${key}-01`) : ""}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(byMonth.length - 1, p + 1))}
          disabled={page >= byMonth.length - 1}
          aria-label="Next month"
          className="px-2 py-1 text-pale/60 hover:text-gold disabled:opacity-25 disabled:hover:text-pale/60"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px px-3 pt-3 text-center">
        {DOW.map((d) => (
          <span key={d} className="accent text-[0.55rem] text-pale/40 pb-1">{d.slice(0, 1)}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 p-3 pt-1">
        {Array.from({ length: pad }, (_, i) => <span key={`pad${i}`} />)}

        {month.map((d) => {
          const n = Number(d.date.slice(8));
          const isSelected = d.date === selected;

          if (d.state !== "open") {
            /* Unbookable days stay on the calendar rather than vanishing: a
               guest looking for "that Saturday" needs to find it and be told
               why, not be left wondering whether they misremembered. */
            return (
              <span
                key={d.date}
                title={d.reason}
                aria-label={`${d.date} — ${d.reason ?? "unavailable"}`}
                className={`relative grid h-10 place-items-center text-sm cursor-not-allowed
                  ${d.state === "blocked" || d.state === "closed"
                    ? "text-brick/60 line-through"
                    : "text-pale/20"}`}
              >
                {n}
                {(d.state === "blocked" || d.state === "closed") && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-brick/70" aria-hidden="true" />
                )}
              </span>
            );
          }

          return (
            <a
              key={d.date}
              href={hrefPrefix + d.date}
              aria-current={isSelected ? "date" : undefined}
              title={d.free <= 2 ? `Only ${d.free} sitting${d.free === 1 ? "" : "s"} left` : undefined}
              className={`relative grid h-10 place-items-center text-sm transition-colors
                ${isSelected
                  ? "bg-gold font-semibold text-ink"
                  : "text-pale hover:bg-gold/15 hover:text-gold"}`}
            >
              {n}
              {/* A day down to its last sittings is worth saying before they
                  click, not after. */}
              {!isSelected && d.free > 0 && d.free <= 2 && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-gold" aria-hidden="true" />
              )}
            </a>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[--line] px-4 py-3 text-[0.68rem] text-pale/50">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 bg-gold" aria-hidden="true" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brick/70" aria-hidden="true" /> Closed or booked out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" /> Only a couple of sittings left
        </span>
      </div>

      {/* So the surrounding GET form still submits a date when someone uses the
          Update button rather than clicking a day. */}
      <input type="hidden" name={name} value={selected ?? ""} />
    </div>
  );
}
