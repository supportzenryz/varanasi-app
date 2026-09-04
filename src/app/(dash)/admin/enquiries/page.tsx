import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, enquiries, privateRooms, users } from "@/db/schema";
import { requireAbility, can } from "@/lib/auth";
import { TYPE_LABEL, type EnquiryType } from "@/lib/enquiry";
import { setEnquiryStatus, saveEnquiryNote } from "./actions";
import { buildEnquiryWhere, selectEnquiries, RANGES, type EnquiryQuery } from "./filters";

export const metadata = { title: "Enquiries" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";

const STATUS_COLOUR: Record<string, string> = {
  new: "bg-gold/20 text-gold-ink",
  contacted: "bg-leaf/15 text-leaf",
  confirmed: "bg-ink/10 text-ink",
  closed: "bg-ink/5 text-ink-3",
};

const LIMIT = 200;

export default async function EnquiriesAdmin({
  searchParams,
}: { searchParams: Promise<EnquiryQuery> }) {
  const session = await requireAbility("viewEnquiries");
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const range = sp.range ?? "all";
  const params: EnquiryQuery = { ...sp, status, range };

  const all = db.select().from(branches).all();
  const visible = session.role === "owner" ? all : all.filter((b) => b.id === session.branchId);
  const cityOf = new Map(all.map((b) => [b.id, b.city]));

  const rows = selectEnquiries(session, params, LIMIT);

  // The counts on the status tabs have to respect the other filters, or the
  // tab says 14 and the list shows 3.
  const matching = db.select({ n: sql<number>`count(*)` }).from(enquiries)
    .where(buildEnquiryWhere(session, params)).get()?.n ?? 0;
  const countFor = (s: string) =>
    db.select({ n: sql<number>`count(*)` }).from(enquiries)
      .where(buildEnquiryWhere(session, { ...params, status: s })).get()?.n ?? 0;

  const staffName = new Map(
    db.select({ id: users.id, name: users.name }).from(users).all().map((s) => [s.id, s.name]),
  );
  const roomName = new Map(
    db.select({ id: privateRooms.id, name: privateRooms.name }).from(privateRooms).all().map((r) => [r.id, r.name]),
  );

  const editable = can(session, "editEnquiries");

  /** Builds a link that keeps every filter except the ones being changed. */
  const href = (o: Partial<EnquiryQuery>, base = "/admin/enquiries") => {
    const p = new URLSearchParams();
    const merged = { status, type: sp.type, branch: sp.branch, range, q: sp.q, ...o };
    for (const [k, v] of Object.entries(merged)) {
      if (v && !(k === "range" && v === "all") && !(k === "status" && v === "open")) p.set(k, String(v));
    }
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const filtered = Boolean(sp.q || sp.branch || sp.type || range !== "all" || status !== "open");

  return (
    <>
      <span className="accent text-gold-ink">Enquiries</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Enquiries</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Everything sent through the website&rsquo;s forms. Each one is also emailed, but this is the
        record — so nothing gets lost in an inbox.
      </p>

      {/* ---------- search, date range, branch, export ---------- */}
      <form method="GET" action="/admin/enquiries"
        className="mt-8 border border-[--line] bg-white/60 p-4 grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        {/* the filters not represented by a control here still have to survive
            a search, so they ride along as hidden fields */}
        {status !== "open" && <input type="hidden" name="status" value={status} />}
        {sp.type && <input type="hidden" name="type" value={sp.type} />}

        <div>
          <label className="block text-xs font-semibold text-ink-3 mb-1" htmlFor="q">
            Search name, email, phone or company
          </label>
          <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} className={field}
            placeholder="jane@example.com · 0121 633 3700 · Patel" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-3 mb-1" htmlFor="range">Received</label>
          <select id="range" name="range" defaultValue={range} className={field}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>

        {visible.length > 1 && (
          <div>
            <label className="block text-xs font-semibold text-ink-3 mb-1" htmlFor="branch">Location</label>
            <select id="branch" name="branch" defaultValue={sp.branch ?? ""} className={field}>
              <option value="">All locations</option>
              {visible.map((b) => <option key={b.id} value={b.slug}>{b.city}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <button className="bg-ink text-pale px-5 py-2 text-sm font-semibold whitespace-nowrap">Search</button>
          {filtered && (
            <Link href="/admin/enquiries"
              className="border border-[--line] px-4 py-2 text-sm hover:bg-pale whitespace-nowrap">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-ink-3">
          {matching === 0 ? "No matches" : `${matching} enquir${matching === 1 ? "y" : "ies"} match`}
          {matching > LIMIT && ` — showing the ${LIMIT} most recent`}
        </p>
        {/* A plain link, so the browser handles the download and the export
            inherits whatever is filtered right now. Hidden for the staff role:
            the route refuses them anyway, and offering a button that returns a
            permission error is worse than not offering it. */}
        {can(session, "exportEnquiries") && (
          <a href={href({}, "/admin/enquiries/export")}
            className="text-sm border border-[--line] bg-white px-4 py-1.5 hover:bg-pale font-semibold">
            Export {filtered ? "these" : "all"} to CSV
          </a>
        )}
      </div>

      {/* ---------- status tabs ---------- */}
      <div className="flex flex-wrap gap-1 mt-6 border-b border-[--line]">
        {[
          ["open", "Open"],
          ["new", "New"],
          ["contacted", "Contacted"],
          ["confirmed", "Confirmed"],
          ["closed", "Closed"],
          ["all", "All"],
        ].map(([key, labelText]) => (
          <Link key={key} href={href({ status: key })}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${
              status === key ? "border-gold font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}>
            {labelText} <span className="tnum text-ink-3">({countFor(key)})</span>
          </Link>
        ))}
      </div>

      {/* ---------- type filter ---------- */}
      <div className="flex flex-wrap gap-2 mt-5">
        <Link href={href({ type: undefined })}
          className={`text-xs px-3 py-1.5 border ${!sp.type ? "border-gold text-gold-ink" : "border-[--line] text-ink-3 hover:text-ink"}`}>
          All types
        </Link>
        {(Object.keys(TYPE_LABEL) as EnquiryType[]).map((t) => (
          <Link key={t} href={href({ type: t })}
            className={`text-xs px-3 py-1.5 border ${sp.type === t ? "border-gold text-gold-ink" : "border-[--line] text-ink-3 hover:text-ink"}`}>
            {TYPE_LABEL[t]}
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4">
        {rows.map((e) => (
          <article key={e.id} className={`border border-[--line] ${e.status === "new" ? "bg-white" : "bg-white/50"}`}>
            <details open={e.status === "new"}>
              <summary className="px-5 py-4 cursor-pointer flex flex-wrap items-center gap-4 hover:bg-white">
                <span className={`inline-block px-2 py-1 text-xs font-semibold shrink-0 ${STATUS_COLOUR[e.status]}`}>
                  {e.status}
                </span>
                <span className="flex-1 min-w-48 min-w-0">
                  <span className="block font-medium [overflow-wrap:anywhere]">
                    {e.name}
                    <span className="text-ink-3 font-normal"> · {TYPE_LABEL[e.type as EnquiryType]}</span>
                  </span>
                  <span className="block text-xs text-ink-3 mt-0.5">
                    ENQ-{e.id} · {e.branchId ? cityOf.get(e.branchId) : "No branch"} ·{" "}
                    {new Date((e.createdAt ?? 0) * 1000).toLocaleString("en-GB")}
                    {e.handledByUserId && ` · ${staffName.get(e.handledByUserId) ?? ""}`}
                  </span>
                </span>
                {e.marketingConsent && (
                  <span className="accent text-leaf shrink-0">Marketing opt-in</span>
                )}
              </summary>

              <div className="px-5 pb-5 pt-1 bg-white">
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 text-sm">
                  {[
                    ["Email", e.email ? <a key="e" href={`mailto:${e.email}`} className="underline hover:text-gold-ink">{e.email}</a> : "—"],
                    ["Phone", e.phone ? <a key="p" href={`tel:${e.phone}`} className="underline hover:text-gold-ink tnum">{e.phone}</a> : "—"],
                    ...(e.company ? [["Company", e.company]] : []),
                    ...(e.partySize ? [["Guests", String(e.partySize)]] : []),
                    ...(e.requestedDate ? [["Preferred date", `${e.requestedDate}${e.requestedTime ? ` at ${e.requestedTime}` : ""}`]] : []),
                    ...(e.occasion ? [["Occasion", e.occasion]] : []),
                    ...(e.roomId ? [["Room", roomName.get(e.roomId) ?? "—"]] : []),
                    ...(e.dietary ? [["Dietary", e.dietary]] : []),
                  ].map(([k, v], i) => (
                    /* min-w-0 is the load-bearing part. A grid item defaults to
                       min-width:auto and so refuses to shrink below its content,
                       which means one long unbroken string a guest typed — a
                       pasted URL in the dietary box — widens the whole column
                       and, with it, the page. break-words alone cannot override
                       that. Measured before: 33,583px wide at a 1440 viewport,
                       pushing every filter and button off-screen. */
                    <div key={i} className="min-w-0">
                      <dt className="text-xs font-semibold text-ink-3">{k as string}</dt>
                      <dd className="mt-0.5 [overflow-wrap:anywhere]">{v as React.ReactNode}</dd>
                    </div>
                  ))}
                </dl>

                {e.message && (
                  <div className="mt-5 border-l-2 border-[--line] pl-4">
                    <span className="text-xs font-semibold text-ink-3">Their message</span>
                    <p className="mt-1 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{e.message}</p>
                  </div>
                )}

                {editable && (
                  <>
                    <form action={setEnquiryStatus} className="mt-6 pt-5 border-t border-[--line] flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      {(["new", "contacted", "confirmed", "closed"] as const)
                        .filter((s) => s !== e.status)
                        .map((s) => (
                          <button key={s} name="status" value={s}
                            className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale capitalize">
                            Mark {s}
                          </button>
                        ))}
                    </form>

                    <form action={saveEnquiryNote} className="mt-4 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={e.id} />
                      <div className="flex-1 min-w-[16rem]">
                        <label className="block text-xs font-semibold text-ink-3 mb-1" htmlFor={`note${e.id}`}>
                          Internal note (never shown to the customer)
                        </label>
                        <input id={`note${e.id}`} name="internalNote" defaultValue={e.internalNote ?? ""}
                          className={field} />
                      </div>
                      <button className="text-xs border border-[--line] px-3 py-2 hover:bg-pale">Save note</button>
                    </form>
                  </>
                )}
              </div>
            </details>
          </article>
        ))}

        {rows.length === 0 && (
          <p className="border border-[--line] bg-white/50 px-5 py-10 text-center text-ink-3">
            {filtered
              ? "Nothing matches those filters. Try widening the date range or clearing the search."
              : "No open enquiries — all caught up."}
          </p>
        )}
      </div>
    </>
  );
}
