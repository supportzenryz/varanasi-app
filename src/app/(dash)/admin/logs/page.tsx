import Link from "next/link";
import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireAbility } from "@/lib/auth";
import { ownerRecipients } from "@/lib/audit";
import { mailMode } from "@/lib/email";

export const metadata = { title: "Activity log" };
export const dynamic = "force-dynamic";

const PER_PAGE = 100;

/** The action prefixes, grouped the way someone looking for something thinks
 *  about it rather than the way the strings happen to be namespaced. */
const AREAS: { key: string; label: string; match: string[] }[] = [
  { key: "money", label: "Money", match: ["voucher.", "booking.refund", "settings.booking"] },
  { key: "access", label: "Accounts & access", match: ["user.", "password.", "login", "logout"] },
  { key: "data", label: "Data leaving", match: ["enquiry.export", "backup."] },
  { key: "menu", label: "Menus & rooms", match: ["menu.", "room.", "gallery.", "stat."] },
  { key: "bookings", label: "Reservations", match: ["booking.", "blocked_date.", "enquiry."] },
];

function when(at: number): string {
  return new Date(at * 1000).toLocaleString("en-GB", {
    timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
  });
}

/** Entries nobody has to go looking for — they are emailed as they happen. */
const LOUD = ["user.", "settings.", "voucher.cancel", "voucher.issue",
  "backup.download", "enquiry.export", "login.locked"];
const isLoud = (a: string) => LOUD.some((p) => a.startsWith(p));

export default async function LogsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; who?: string; area?: string; page?: string }>;
}) {
  await requireAbility("viewAuditLog");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const who = sp.who ?? "";
  const area = sp.area ?? "";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const staff = db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).all();
  const byId = new Map(staff.map((u) => [u.id, u]));

  const filters: SQL[] = [];
  if (who) filters.push(eq(auditLog.userId, Number(who)));
  if (q) {
    const term = `%${q}%`;
    filters.push(or(
      like(auditLog.action, term), like(auditLog.entityId, term), like(auditLog.detail, term),
    )!);
  }
  const chosen = AREAS.find((a) => a.key === area);
  if (chosen) {
    filters.push(or(...chosen.match.map((m) => like(auditLog.action, `${m}%`)))!);
  }
  const where = filters.length ? and(...filters) : undefined;

  const total = db.select({ n: sql<number>`count(*)` }).from(auditLog).where(where).get()?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const rows = db.select().from(auditLog).where(where)
    .orderBy(desc(auditLog.id)).limit(PER_PAGE).offset((page - 1) * PER_PAGE).all();

  const to = ownerRecipients();
  const mode = mailMode();

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { q, who, area, page: String(page), ...over };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "1") p.set(k, v);
    const s = p.toString();
    return s ? `/admin/logs?${s}` : "/admin/logs";
  };

  return (
    <>
      <span className="accent text-xs text-gold-ink">Activity log</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Everything staff have changed</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Every action in the admin is written down here as it happens — who did it, when, and
        what changed. Nothing can be edited or removed from this list.
      </p>

      {/* Say where the reports go. An owner who assumes they are being emailed
          and is not has no way to find that out from a page of entries. */}
      <p className="text-sm text-ink-3 mt-4 border-l-2 border-[--line] pl-4 max-w-[70ch]">
        {to.length ? (
          <>
            Anything touching money, accounts or personal data is emailed to{" "}
            <strong>{to.join(", ")}</strong> straight away; the rest arrives in a daily summary.{" "}
            {mode === "outbox" && (
              <span className="text-brick">
                No email provider is configured, so those messages are being written to{" "}
                <code>data/outbox</code> instead of sent.
              </span>
            )}
          </>
        ) : (
          <span className="text-brick">
            Nowhere to send the reports. Set <code>OWNER_EMAIL</code>, or give an owner account
            an email address, and the alerts and daily summary will start.
          </span>
        )}
      </p>

      <form className="mt-8 flex flex-wrap items-end gap-3" action="/admin/logs">
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="code, name, price…"
            className="border border-[--line] bg-white px-3 py-2 text-sm w-56" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="who">Who</label>
          <select id="who" name="who" defaultValue={who}
            className="border border-[--line] bg-white px-3 py-2 text-sm">
            <option value="">Anyone</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="area">Area</label>
          <select id="area" name="area" defaultValue={area}
            className="border border-[--line] bg-white px-3 py-2 text-sm">
            <option value="">Everything</option>
            {AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <button className="bg-ink text-pale px-5 py-2 text-sm font-semibold">Filter</button>
        {(q || who || area) && (
          <Link href="/admin/logs" className="text-sm underline text-ink-3 py-2">Clear</Link>
        )}
      </form>

      <p className="text-sm text-ink-3 mt-6">
        {total.toLocaleString("en-GB")} entr{total === 1 ? "y" : "ies"}
        {pages > 1 && <> · page {page} of {pages}</>}
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 border border-[--line] bg-white/60 px-5 py-8 text-center text-ink-3">
          Nothing matches that.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto border border-[--line]">
          <table className="w-full text-sm bg-white/60">
            <thead className="bg-pale text-left">
              <tr>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">When</th>
                <th className="px-4 py-2.5 font-semibold">Who</th>
                <th className="px-4 py-2.5 font-semibold">What</th>
                <th className="px-4 py-2.5 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const u = r.userId != null ? byId.get(r.userId) : undefined;
                return (
                  <tr key={r.id} className="border-t border-[--line] align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap tnum text-ink-3">{when(r.createdAt)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {u ? u.name : <span className="text-ink-3 italic">not signed in</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <code className="text-xs">{r.action}</code>
                      {isLoud(r.action) && (
                        <span title="Emailed to the owner as it happened"
                          className="ml-2 text-[0.58rem] uppercase tracking-widest text-gold-ink">
                          emailed
                        </span>
                      )}
                      {r.entityId && r.entityId !== "-" && (
                        <span className="block text-xs text-ink-3">{r.entityId}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-3 [overflow-wrap:anywhere]">{r.detail ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-5 flex items-center gap-4 text-sm">
          {page > 1 && <Link className="underline" href={href({ page: String(page - 1) })}>Newer</Link>}
          {page < pages && <Link className="underline" href={href({ page: String(page + 1) })}>Older</Link>}
        </div>
      )}
    </>
  );
}
