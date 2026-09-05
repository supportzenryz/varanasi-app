import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { branches, bookings, privateRooms } from "@/db/schema";
import { requireAbility, can } from "@/lib/auth";
import { formatPence } from "@/lib/money";
import { prettyTime } from "@/lib/booking-config";
import { expireStaleHolds } from "@/lib/booking";
import { AdminNotice } from "@/components/AdminNotice";
import { addBooking, updateBookingStatus } from "./actions";

export const metadata = { title: "Reservations" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";

const STATUS_LABEL: Record<string, string> = {
  held: "Held", confirmed: "Confirmed", seated: "Seated",
  completed: "Completed", cancelled: "Cancelled", no_show: "No-show",
};
const STATUS_COLOUR: Record<string, string> = {
  held: "bg-gold/15 text-gold-ink",
  confirmed: "bg-leaf/15 text-leaf",
  seated: "bg-ink/10 text-ink",
  completed: "bg-ink/5 text-ink-3",
  cancelled: "bg-brick/10 text-brick",
  no_show: "bg-brick/10 text-brick",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BookingsAdmin({
  searchParams,
}: { searchParams: Promise<{ branch?: string; date?: string; view?: string; saved?: string; problem?: string }> }) {
  const session = await requireAbility("viewBookings");
  const { branch: branchParam, date: dateParam, view, saved, problem } = await searchParams;
  const showUpcoming = view === "upcoming";

  // Unpaid holds shouldn't sit in the list looking like real bookings.
  expireStaleHolds();

  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const visible = session.role === "owner" ? all : all.filter((b) => b.id === session.branchId);
  const active = visible.find((b) => b.slug === branchParam) ?? visible[0];
  if (!active) notFound();

  const date = dateParam || todayISO();
  const rows = showUpcoming
    ? db.select().from(bookings)
        .where(and(eq(bookings.branchId, active.id), gte(bookings.date, todayISO())))
        .orderBy(asc(bookings.date), asc(bookings.time)).all()
    : db.select().from(bookings)
        .where(and(eq(bookings.branchId, active.id), eq(bookings.date, date)))
        .orderBy(asc(bookings.time)).all();

  const rooms = db.select().from(privateRooms).where(eq(privateRooms.branchId, active.id)).all();
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const editable = can(session, "editBookings");

  const partyTotal = rows.reduce((sum, r) =>
    ["cancelled", "no_show"].includes(r.status) ? sum : sum + r.partySize, 0);

  return (
    <>
      <AdminNotice saved={saved} problem={problem} />
      <span className="accent text-xs text-gold-ink">Reservations</span>
      <h1 className="text-3xl sm:text-4xl mt-3">{active.city}&rsquo;s bookings</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Every reservation that comes through the website lands here, alongside anything logged by phone.
        {!editable && " You can view these, but only a manager or owner can change them."}
      </p>

      {visible.length > 1 && (
        <div className="flex gap-1 mt-7 border-b border-[--line]">
          {visible.map((b) => (
            <Link key={b.id} href={`/admin/bookings?branch=${b.slug}`}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${
                b.id === active.id ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
              {b.city}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <form className="flex items-end gap-2">
          <input type="hidden" name="branch" value={active.slug} />
          <div>
            <label className={label} htmlFor="date">Date</label>
            <input id="date" name="date" type="date" defaultValue={date} className={field} />
          </div>
          <button className="border border-[--line] px-3 py-2 text-sm hover:bg-pale">Show</button>
        </form>
        <Link href={`/admin/bookings?branch=${active.slug}&view=upcoming`}
          className={`text-sm px-3 py-2 border ${showUpcoming ? "border-gold text-gold-ink font-semibold" : "border-[--line] text-ink-3 hover:text-ink"}`}>
          All upcoming
        </Link>
        <span className="text-sm text-ink-3 ml-auto tnum">
          {rows.length} booking{rows.length === 1 ? "" : "s"} · {partyTotal} covers
        </span>
      </div>

      <div className="mt-5 border border-[--line] bg-white/50 overflow-x-auto">
        <table className="w-full text-sm min-w-[46rem]">
          <thead>
            <tr className="text-left text-xs text-ink-3 border-b border-[--line]">
              {!showUpcoming && <th className="px-4 py-3 font-semibold">Time</th>}
              {showUpcoming && <th className="px-4 py-3 font-semibold">Date &amp; time</th>}
              <th className="px-4 py-3 font-semibold">Guest</th>
              <th className="px-4 py-3 font-semibold">Party</th>
              <th className="px-4 py-3 font-semibold">Deposit</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              {editable && <th className="px-4 py-3 font-semibold">Change status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[--line] last:border-0 align-top">
                <td className="px-4 py-3 tnum whitespace-nowrap">
                  {showUpcoming ? `${r.date} · ${prettyTime(r.time)}` : prettyTime(r.time)}
                  <span className="block text-[0.68rem] text-ink-3 mt-0.5">{r.reference}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="block font-medium">{r.guestName}</span>
                  <span className="block text-xs text-ink-3 mt-0.5">
                    {[r.phone, r.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                  {r.occasion && r.occasion !== "No special occasion" && (
                    <span className="block text-xs text-gold-ink mt-0.5">{r.occasion}</span>
                  )}
                  {r.dietary && (
                    <span className="block text-xs text-brick mt-0.5">
                      Allergies: {r.dietary.split(",").join(", ")}
                    </span>
                  )}
                  {r.roomId && (
                    <span className="block text-xs text-ink-3 mt-0.5">{roomName.get(r.roomId)}</span>
                  )}
                  {r.notes && <span className="block text-xs text-ink-3/80 mt-0.5 max-w-[20rem]">{r.notes}</span>}
                </td>
                <td className="px-4 py-3 tnum">{r.partySize}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.depositPence ? (
                    <>
                      <span className="tnum">{formatPence(r.depositPence)}</span>
                      <span className={`block text-[0.68rem] mt-0.5 ${
                        r.depositStatus === "captured" ? "text-leaf"
                          : r.depositStatus === "required" ? "text-gold-ink" : "text-brick"}`}>
                        {r.depositStatus === "captured" ? "paid"
                          : r.depositStatus === "required" ? "awaiting payment" : r.depositStatus}
                      </span>
                    </>
                  ) : <span className="text-ink-3">—</span>}
                </td>
                <td className="px-4 py-3 capitalize text-ink-3">{r.source.replace("_", " ")}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-1 text-xs font-semibold ${STATUS_COLOUR[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                {editable && (
                  <td className="px-4 py-3">
                    <form action={updateBookingStatus} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="id" value={r.id} />
                      {(["confirmed", "seated", "completed", "cancelled", "no_show"] as const)
                        .filter((s) => s !== r.status)
                        .map((s) => (
                          <button key={s} name="status" value={s}
                            className="text-[0.7rem] border border-[--line] px-2 py-1 hover:bg-pale whitespace-nowrap">
                            {STATUS_LABEL[s]}
                          </button>
                        ))}
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={editable ? 7 : 6} className="px-4 py-8 text-center text-ink-3">
                Nothing {showUpcoming ? "upcoming" : "booked for this date"} yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <details className="mt-8 border border-[--line] bg-white/50">
          <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
            Log a phone or walk-in booking
          </summary>
          <form action={addBooking} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
            <input type="hidden" name="branchId" value={active.id} />
            <div><label className={label} htmlFor="gn">Guest name</label>
              <input id="gn" name="guestName" className={field} required /></div>
            <div><label className={label} htmlFor="ps">Party size</label>
              <input id="ps" name="partySize" type="number" min={1} className={field} required /></div>
            <div><label className={label} htmlFor="bd">Date</label>
              <input id="bd" name="date" type="date" defaultValue={date} className={field} required /></div>
            <div><label className={label} htmlFor="bt">Time</label>
              <input id="bt" name="time" type="time" className={field} required /></div>
            <div><label className={label} htmlFor="ph">Phone</label>
              <input id="ph" name="phone" className={field} /></div>
            <div><label className={label} htmlFor="em">Email</label>
              <input id="em" name="email" type="email" className={field} /></div>
            <div><label className={label} htmlFor="oc">Occasion</label>
              <input id="oc" name="occasion" placeholder="Birthday, anniversary…" className={field} /></div>
            <div><label className={label} htmlFor="src">How it came in</label>
              <select id="src" name="source" defaultValue="phone" className={field}>
                <option value="phone">Phone</option>
                <option value="walk_in">Walk-in</option>
              </select>
            </div>
            <div className="sm:col-span-2"><label className={label} htmlFor="dt">Dietary notes</label>
              <input id="dt" name="dietary" className={field} /></div>
            <div className="sm:col-span-2"><label className={label} htmlFor="nt">Notes</label>
              <textarea id="nt" name="notes" rows={2} className={field} /></div>
            <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
              Add booking
            </button>
          </form>
        </details>
      )}
    </>
  );
}
