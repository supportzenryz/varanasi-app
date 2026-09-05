import { requireAbility } from "@/lib/auth";
import { formatPence } from "@/lib/money";
import { AdminNotice } from "@/components/AdminNotice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { findPersonalData } from "@/lib/erasure";
import { eraseAction } from "./actions";

export const metadata = { title: "Erasure requests" };
export const dynamic = "force-dynamic";

const field = "w-full border border-[--line] bg-white px-3 py-2 text-sm outline-none focus:border-gold";

function when(at: number): string {
  return new Date(at * 1000).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" });
}

export default async function ErasurePage({ searchParams }: {
  searchParams: Promise<{ q?: string; saved?: string; problem?: string }>;
}) {
  await requireAbility("erasePersonalData");
  const { q, saved, problem } = await searchParams;
  const query = (q ?? "").trim();
  const found = query.length >= 3 ? findPersonalData(query) : null;
  const total = found ? found.enquiries.length + found.bookings.length + found.vouchers.length : 0;
  const live = found?.vouchers.filter((v) => v.live) ?? [];

  return (
    <>
      <AdminNotice saved={saved} problem={problem} />
      <span className="accent text-xs text-gold-ink">Erasure requests</span>
      <h1 className="text-3xl sm:text-4xl mt-3">Someone has asked to be forgotten</h1>
      <p className="text-ink-3 mt-2 max-w-[64ch]">
        Under UK GDPR a person can ask you to erase what you hold about them, and you have
        <strong> one month </strong> to do it and tell them you have. Search by whatever
        they gave you — an email address, a phone number, or their name.
      </p>

      <form action="/admin/erasure" className="mt-8 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-ink-3 mb-1" htmlFor="q">
            Email, phone or name
          </label>
          <input id="q" name="q" defaultValue={query} required minLength={3}
            placeholder="guest@example.com" className={`${field} w-80`} />
        </div>
        <button className="bg-ink text-pale px-5 py-2 text-sm font-semibold">Find everything</button>
      </form>

      {found && total === 0 && (
        <p className="mt-8 border border-[--line] bg-white/60 px-5 py-8 text-center text-ink-3">
          Nothing held for &ldquo;{query}&rdquo;. You can reply saying so — that is a complete
          and correct answer to the request.
        </p>
      )}

      {found && total > 0 && (
        <>
          <h2 className="text-xl mt-10">What we hold ({total})</h2>

          {found.bookings.length > 0 && (
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-ink-3">
                Bookings ({found.bookings.length})
              </h3>
              <div className="mt-2 overflow-x-auto border border-[--line]">
                <table className="w-full text-sm bg-white/60">
                  <tbody>
                    {found.bookings.map((b) => (
                      <tr key={b.id} className="border-b border-[--line] last:border-0">
                        <td className="px-4 py-2.5 tnum whitespace-nowrap">{b.reference}</td>
                        <td className="px-4 py-2.5">{b.guestName}</td>
                        <td className="px-4 py-2.5 text-ink-3">{b.email ?? b.phone ?? "—"}</td>
                        <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap">{b.date} · {b.status}</td>
                        <td className="px-4 py-2.5 text-xs text-ink-3">{b.erased ? "already erased" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {found.enquiries.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-ink-3">
                Enquiries ({found.enquiries.length})
              </h3>
              <div className="mt-2 overflow-x-auto border border-[--line]">
                <table className="w-full text-sm bg-white/60">
                  <tbody>
                    {found.enquiries.map((e) => (
                      <tr key={e.id} className="border-b border-[--line] last:border-0">
                        <td className="px-4 py-2.5 whitespace-nowrap text-ink-3">{when(e.createdAt)}</td>
                        <td className="px-4 py-2.5 capitalize">{e.type.replace("_", " ")}</td>
                        <td className="px-4 py-2.5">{e.name}</td>
                        <td className="px-4 py-2.5 text-ink-3">{e.email ?? e.phone ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-ink-3">{e.erased ? "already erased" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {found.vouchers.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-ink-3">
                Gift vouchers ({found.vouchers.length})
              </h3>
              <div className="mt-2 overflow-x-auto border border-[--line]">
                <table className="w-full text-sm bg-white/60">
                  <tbody>
                    {found.vouchers.map((v) => (
                      <tr key={v.id} className="border-b border-[--line] last:border-0">
                        <td className="px-4 py-2.5 tnum whitespace-nowrap">{v.code}</td>
                        <td className="px-4 py-2.5">{v.who}</td>
                        <td className="px-4 py-2.5 tnum">{formatPence(v.balancePence)}</td>
                        <td className={`px-4 py-2.5 ${v.live ? "text-brick font-semibold" : "text-ink-3"}`}>
                          {v.status}{v.live ? " — still worth money" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {live.length > 0 ? (
            <section className="mt-8 border-l-2 border-brick bg-brick/8 px-5 py-4 max-w-[70ch]">
              <h3 className="text-lg">This one can&rsquo;t be erased yet</h3>
              <p className="text-sm text-ink-3 mt-1.5">
                They hold {live.length} voucher{live.length === 1 ? "" : "s"} still worth{" "}
                <strong>{formatPence(live.reduce((s, v) => s + v.balancePence, 0))}</strong> —{" "}
                {live.map((v) => v.code).join(", ")}. That is money the restaurant owes to whoever
                presents the code. Taking the name off it would not cancel the debt, it would only
                make it impossible to attribute — worse for them, not better.
              </p>
              <p className="text-sm text-ink-3 mt-2">
                Settle it or cancel it on the Gift vouchers screen first, then come back here.
              </p>
            </section>
          ) : (
            <section className="mt-8 border border-[--line] bg-white/60 px-5 py-5 max-w-[70ch]">
              <h3 className="text-lg">Erase all of it</h3>
              <p className="text-sm text-ink-3 mt-1.5">
                The name, email, phone, company, occasion, notes and any allergy or dietary
                information will be removed from every record above, along with their marketing
                consent and the self-service link in their confirmation email. Allergy notes are
                health data, and are the most sensitive thing here.
              </p>
              <p className="text-sm text-ink-3 mt-2">
                The records themselves stay, with the person taken out of them. A booking is a
                trading record — covers on a night, a deposit taken — and HMRC requires those kept
                for six years. UK GDPR Article 17(3) allows exactly this.
              </p>
              <p className="text-sm text-ink-3 mt-2">
                <strong>Two things this cannot reach.</strong> Backups taken before today still
                hold the old data; they are pruned on a rolling basis and age out on their own, but
                if one is ever restored this has to be run again. And emails already sent — their
                confirmation, and the copy in the restaurant&rsquo;s inbox — are outside this system.
              </p>

              <form action={eraseAction} className="mt-5 flex flex-wrap items-end gap-3">
                <input type="hidden" name="q" value={query} />
                <div>
                  <label className="block text-xs font-semibold text-ink-3 mb-1" htmlFor="confirm">
                    Type <code className="tnum">{query}</code> to confirm
                  </label>
                  <input id="confirm" name="confirm" required className={`${field} w-80`} autoComplete="off" />
                </div>
                <ConfirmButton
                  ask={`Erase this person from ${total} record${total === 1 ? "" : "s"}? This cannot be undone.`}
                  className="bg-brick text-pale px-5 py-2.5 text-sm font-semibold">
                  Erase permanently
                </ConfirmButton>
              </form>
            </section>
          )}
        </>
      )}

      <section className="mt-12 border-t border-[--line] pt-6 max-w-[70ch]">
        <h2 className="text-lg">Before you erase</h2>
        <ul className="text-sm text-ink-3 mt-2 space-y-1.5 list-disc pl-5">
          <li>Check it is really them. An erasure request from someone else&rsquo;s address is a
            way of deleting a rival&rsquo;s booking, or covering a trail.</li>
          <li>You may refuse a request that is manifestly unfounded or excessive, and you may
            charge for repeats — but you have to say so, and say why.</li>
          <li>Reply to them either way, within one month. The Activity log records that this was
            done and when, without keeping their address.</li>
        </ul>
      </section>
    </>
  );
}
