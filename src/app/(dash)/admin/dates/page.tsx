import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { branches, blockedDates, privateRooms } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { addBlockedDate, deleteBlockedDate } from "./actions";

export const metadata = { title: "Blocked dates" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BlockedDatesAdmin({
  searchParams,
}: { searchParams: Promise<{ branch?: string }> }) {
  const session = await requireAbility("editBlockedDates");
  const { branch: branchParam } = await searchParams;

  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const visible = session.role === "owner" ? all : all.filter((b) => b.id === session.branchId);
  const active = visible.find((b) => b.slug === branchParam) ?? visible[0];
  if (!active) notFound();

  const rows = db.select().from(blockedDates)
    .where(and(eq(blockedDates.branchId, active.id), gte(blockedDates.date, todayISO())))
    .orderBy(asc(blockedDates.date)).all();

  const rooms = db.select().from(privateRooms).where(eq(privateRooms.branchId, active.id))
    .orderBy(asc(privateRooms.sort)).all();
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <>
      <span className="accent text-xs text-gold-ink">Blocked dates</span>
      <h1 className="text-3xl sm:text-4xl mt-3">{active.city}&rsquo;s closed dates</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Close the whole branch for a bank holiday or refurbishment, or block just one private room for an
        exclusive hire. Anything listed here stops new reservations landing on that date.
      </p>

      {visible.length > 1 && (
        <div className="flex gap-1 mt-7 border-b border-[--line]">
          {visible.map((b) => (
            <Link key={b.id} href={`/admin/dates?branch=${b.slug}`}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                b.id === active.id ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {b.city}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 border border-[--line] bg-white/50 overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead>
            <tr className="text-left text-xs text-ink-3 border-b border-[--line]">
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Covers</th>
              <th className="px-4 py-3 font-semibold">Reason</th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[--line] last:border-0">
                <td className="px-4 py-3 tnum whitespace-nowrap">
                  {r.date}
                  {!r.allDay && r.fromTime && (
                    <span className="block text-xs text-ink-3">{r.fromTime}–{r.toTime}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.roomId ? roomName.get(r.roomId) ?? "One room" : "Whole branch"}
                </td>
                <td className="px-4 py-3 text-ink-3">{r.reason ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <form action={deleteBlockedDate}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-xs text-brick border border-brick/40 px-3 py-1.5 hover:bg-clay/10 whitespace-nowrap">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-3">
                Nothing blocked ahead — the branch is open every day.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="mt-8 border border-[--line] bg-white/50">
        <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
          Block a date
        </summary>
        <form action={addBlockedDate} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
          <input type="hidden" name="branchId" value={active.id} />
          <div><label className={label} htmlFor="d">Date</label>
            <input id="d" name="date" type="date" min={todayISO()} className={field} required /></div>
          <div><label className={label} htmlFor="r">Room (leave blank to close the whole branch)</label>
            <select id="r" name="roomId" defaultValue="" className={field}>
              <option value="">Whole branch</option>
              {rooms.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="allDay" defaultChecked /> All day
          </label>
          <div><label className={label} htmlFor="ft">From (if not all day)</label>
            <input id="ft" name="fromTime" type="time" className={field} /></div>
          <div><label className={label} htmlFor="tt">To</label>
            <input id="tt" name="toTime" type="time" className={field} /></div>
          <div className="sm:col-span-2"><label className={label} htmlFor="rs">Reason</label>
            <input id="rs" name="reason" placeholder="Christmas Day, private hire, refurbishment…" className={field} /></div>
          <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
            Block this date
          </button>
        </form>
      </details>
    </>
  );
}
