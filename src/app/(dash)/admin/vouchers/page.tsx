import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, vouchers, users } from "@/db/schema";
import { requireAbility, can } from "@/lib/auth";
import { formatPence } from "@/lib/money";
import { voucherRules } from "@/lib/booking-config";
import { voucherByCode, redemptionsFor, expiryLabel, expireOldVouchers } from "@/lib/voucher";
import { redeemVoucher, issueVoucher, cancelVoucher, releaseScheduled } from "./actions";

export const metadata = { title: "Gift vouchers" };

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";
const label = "block text-xs font-semibold text-ink-3 mb-1";

const STATUS_COLOUR: Record<string, string> = {
  active: "bg-leaf/15 text-leaf",
  pending: "bg-gold/15 text-gold-ink",
  redeemed: "bg-ink/10 text-ink-3",
  expired: "bg-brick/10 text-brick",
  cancelled: "bg-brick/10 text-brick",
};

export default async function VouchersAdmin({
  searchParams,
}: { searchParams: Promise<{ code?: string; error?: string; done?: string }> }) {
  const session = await requireAbility("redeemVoucher");
  const { code, error, done } = await searchParams;

  // Anything past its date stops being redeemable the moment this screen opens.
  expireOldVouchers();

  const rules = voucherRules();
  const all = db.select().from(branches).orderBy(asc(branches.sort)).all();
  const looked = code ? voucherByCode(code) : undefined;
  const history = looked ? redemptionsFor(looked.id) : [];
  const staff = db.select({ id: users.id, name: users.name }).from(users).all();
  const staffName = new Map(staff.map((s) => [s.id, s.name]));

  const outstanding = db.select({
    n: sql<number>`count(*)`, v: sql<number>`coalesce(sum(balance_pence),0)`,
  }).from(vouchers).where(sql`status = 'active'`).get();

  const soldThisMonth = db.select({
    n: sql<number>`count(*)`, v: sql<number>`coalesce(sum(value_pence),0)`,
  }).from(vouchers).where(sql`origin = 'purchase' and status != 'pending' and issued_at >= strftime('%s', date('now','start of month'))`).get();

  const scheduled = db.select({ n: sql<number>`count(*)` }).from(vouchers)
    .where(sql`status = 'active' and delivered_at is null and deliver_on is not null`).get()?.n ?? 0;

  const recent = db.select().from(vouchers)
    .orderBy(desc(vouchers.createdAt)).limit(25).all();

  const canIssue = can(session, "issueVoucher");
  const canCancel = can(session, "cancelVoucher");

  return (
    <>
      <span className="accent text-xs text-gold-ink">Gift vouchers</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Vouchers</h1>
      <p className="text-ink-3 mt-2 max-w-[62ch]">
        Look a voucher up by its code to check the balance or take money off it at the till.
      </p>

      {error && <p role="alert" className="mt-6 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">{error}</p>}
      {done && <p role="status" className="mt-6 border-l-2 border-leaf bg-leaf/10 px-4 py-3 text-sm">{done}</p>}

      <div className="mt-8 grid gap-px bg-[--line] sm:grid-cols-3 border border-[--line]">
        <div className="bg-pale p-5">
          <span className="block text-3xl tnum display">{formatPence(outstanding?.v ?? 0) || "£0"}</span>
          <span className="block text-sm text-ink-3 mt-1.5">Outstanding balance</span>
          <span className="block text-xs text-ink-3/70 mt-0.5">{outstanding?.n ?? 0} live vouchers</span>
        </div>
        <div className="bg-pale p-5">
          <span className="block text-3xl tnum display">{formatPence(soldThisMonth?.v ?? 0) || "£0"}</span>
          <span className="block text-sm text-ink-3 mt-1.5">Sold this month</span>
          <span className="block text-xs text-ink-3/70 mt-0.5">{soldThisMonth?.n ?? 0} vouchers</span>
        </div>
        <div className="bg-pale p-5">
          <span className="block text-3xl tnum display">{scheduled}</span>
          <span className="block text-sm text-ink-3 mt-1.5">Waiting for a delivery date</span>
          {canIssue && scheduled > 0 && (
            <form action={releaseScheduled}>
              <button className="text-xs mt-2 underline hover:text-gold-ink">Send any that are due now</button>
            </form>
          )}
        </div>
      </div>

      {/* look up + redeem */}
      <section className="mt-10 border border-[--line] bg-white/50">
        <div className="px-5 sm:px-7 py-6">
          <h2 className="text-xl">Look up a voucher</h2>
          <form className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[16rem]">
              <label className={label} htmlFor="code">Voucher code</label>
              <input id="code" name="code" defaultValue={code ?? ""} placeholder="VG-XXXX-XXXX-XXXX"
                className={`${field} tnum uppercase`} />
            </div>
            <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold">Find it</button>
          </form>
        </div>

        {code && !looked && (
          <p className="px-5 sm:px-7 pb-6 text-sm text-brick">No voucher found with that code.</p>
        )}

        {looked && (
          <div className="border-t border-[--line] px-5 sm:px-7 py-6 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <span className="tnum text-lg">{looked.code}</span>
                <span className={`ml-3 inline-block px-2 py-1 text-xs font-semibold ${STATUS_COLOUR[looked.status]}`}>
                  {looked.status}
                </span>
              </div>
              <div className="text-right">
                <span className="block text-3xl display tnum">{formatPence(looked.balancePence)}</span>
                <span className="block text-xs text-ink-3">of {formatPence(looked.valuePence)} remaining</span>
              </div>
            </div>

            <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 text-sm">
              {[
                ["For", `${looked.recipientName ?? "—"}${looked.recipientEmail ? ` (${looked.recipientEmail})` : ""}`],
                ["From", looked.purchaserName ?? "—"],
                ["Valid at", looked.branchId ? `Varanasi ${all.find((b) => b.id === looked.branchId)?.city ?? ""}` : "Either restaurant"],
                ["Expires", expiryLabel(looked)],
                ["Type", looked.origin === "thank_you" ? "Complimentary (after dining)" : looked.origin === "manual" ? "Issued by staff" : "Bought online"],
                ...(looked.deliverOn ? [["Scheduled delivery", looked.deliverOn + (looked.deliveredAt ? " (sent)" : " (waiting)")]] : []),
                ...(looked.message ? [["Message", `"${looked.message}"`]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold text-ink-3">{k}</dt>
                  <dd className="mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>

            {history.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Already redeemed</h3>
                <ul className="mt-2 text-sm grid gap-1.5">
                  {history.map((r) => (
                    <li key={r.id} className="flex flex-wrap gap-x-4 text-ink-3">
                      <span className="tnum text-ink">{formatPence(r.amountPence)}</span>
                      <span>{new Date((r.createdAt ?? 0) * 1000).toLocaleString("en-GB")}</span>
                      <span>{staffName.get(r.redeemedByUserId ?? -1) ?? "—"}</span>
                      <span className="tnum">{formatPence(r.balanceAfterPence)} left</span>
                      {r.note && <span className="italic">{r.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {looked.status === "active" && looked.balancePence > 0 && (
              <form action={redeemVoucher} className="mt-7 pt-6 border-t border-[--line] flex flex-wrap items-end gap-3">
                <input type="hidden" name="code" value={looked.code} />
                {/* The balance this form was rendered with. The action refuses
                    if it no longer matches, so a double-tap behind the bar, a
                    refreshed page or a replayed request cannot take the money
                    twice — previously each replay succeeded and reported it. */}
                <input type="hidden" name="expectedBalance" value={looked.balancePence} />
                <div>
                  <label className={label} htmlFor="amount">Amount to take off (£)</label>
                  <input id="amount" name="amount" inputMode="decimal" required
                    placeholder={(looked.balancePence / 100).toFixed(2)} className={field} />
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <label className={label} htmlFor="note">Note (optional)</label>
                  <input id="note" name="note" placeholder="Table 12, Friday" className={field} />
                </div>
                <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold">Redeem</button>
              </form>
            )}

            {canCancel && !["cancelled", "redeemed"].includes(looked.status) && (
              <form action={cancelVoucher} className="mt-5">
                <input type="hidden" name="code" value={looked.code} />
                <button className="text-xs text-brick border border-brick/40 px-3 py-1.5 hover:bg-clay/10">
                  Cancel this voucher
                </button>
                <span className="block text-xs text-ink-3 mt-1.5">
                  Owners only. This can&rsquo;t be undone — the balance is written off.
                </span>
              </form>
            )}
          </div>
        )}
      </section>

      {/* issue by hand */}
      {canIssue && (
        <details className="mt-8 border border-[--line] bg-white/50">
          <summary className="px-5 py-3.5 text-sm cursor-pointer text-gold-ink font-semibold hover:bg-white">
            Issue a voucher by hand
          </summary>
          <form action={issueVoucher} className="px-5 pb-5 pt-1 grid gap-4 sm:grid-cols-2 bg-white">
            <div>
              <label className={label} htmlFor="value">Value (£)</label>
              <input id="value" name="value" inputMode="decimal" required className={field} />
            </div>
            <div>
              <label className={label} htmlFor="validAt">Valid at</label>
              <select id="validAt" name="validAt" defaultValue="" className={field}>
                <option value="">Either restaurant</option>
                {all.map((b) => <option key={b.id} value={b.slug}>Varanasi {b.city}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="toName">Recipient name</label>
              <input id="toName" name="toName" required className={field} />
            </div>
            <div>
              <label className={label} htmlFor="toEmail">Recipient email</label>
              <input id="toEmail" name="toEmail" type="email" required className={field} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="message">Message</label>
              <input id="message" name="message" placeholder="With our compliments." className={field} />
            </div>
            <p className="text-xs text-ink-3 sm:col-span-2">
              Issued immediately with no payment taken, and emailed to the recipient. Valid for{" "}
              {rules.expiryMonths} months. Recorded against your name in the audit log.
            </p>
            <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold justify-self-start sm:col-span-2">
              Issue voucher
            </button>
          </form>
        </details>
      )}

      {/* recent */}
      <section className="mt-10">
        <h2 className="text-xl">Recent vouchers</h2>
        <div className="mt-4 border border-[--line] bg-white/50 overflow-x-auto">
          <table className="w-full text-sm min-w-[44rem]">
            <thead>
              <tr className="text-left text-xs text-ink-3 border-b border-[--line]">
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Value</th>
                <th className="px-4 py-3 font-semibold">Balance</th>
                <th className="px-4 py-3 font-semibold">For</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((v) => (
                <tr key={v.id} className="border-b border-[--line] last:border-0">
                  <td className="px-4 py-3 tnum whitespace-nowrap">
                    <a href={`/admin/vouchers?code=${encodeURIComponent(v.code)}`} className="underline hover:text-gold-ink">
                      {v.code}
                    </a>
                  </td>
                  <td className="px-4 py-3 tnum">{formatPence(v.valuePence)}</td>
                  <td className="px-4 py-3 tnum">{formatPence(v.balancePence)}</td>
                  <td className="px-4 py-3">{v.recipientName ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-3 text-xs">
                    {v.origin === "thank_you" ? "Complimentary" : v.origin === "manual" ? "By staff" : "Online"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 text-xs font-semibold ${STATUS_COLOUR[v.status]}`}>
                      {v.status}
                    </span>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-3">
                  No vouchers yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
