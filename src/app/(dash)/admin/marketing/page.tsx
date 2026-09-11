import { desc } from "drizzle-orm";
import { db } from "@/db";
import { marketingContacts } from "@/db/schema";
import { requireAbility, can } from "@/lib/auth";
import { allBranches } from "@/lib/branches";
import { AdminNotice } from "@/components/AdminNotice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { field, hint, label } from "@/lib/forms";
import {
  audienceSize, branchName, listCounts, pendingDraft, recentCampaigns, weekOf,
} from "@/lib/marketing";
import { saveDraft, regenerateDraft, cancelDraft, send } from "./actions";

export const metadata = { title: "Weekly email" };

function when(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-GB", {
    timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
  });
}

const STATUS: Record<string, string> = {
  draft: "bg-gold/15 text-gold-ink",
  sending: "bg-gold/15 text-gold-ink",
  sent: "bg-leaf/15 text-leaf",
  cancelled: "bg-ink/10 text-ink-3",
};

export default async function MarketingAdmin({
  searchParams,
}: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  const session = await requireAbility("editMarketing");
  const mayS = can(session, "sendMarketing");

  const counts = listCounts();
  const draft = pendingDraft();
  const history = recentCampaigns(10);
  const branches = allBranches();
  const willReach = draft ? audienceSize(draft.branchId) : counts.subscribed;

  const newest = db.select().from(marketingContacts)
    .orderBy(desc(marketingContacts.consentedAt)).limit(8).all();

  return (
    <>
      <h1 className="text-3xl mb-1">Weekly email</h1>
      <p className="text-ink-3 mb-7 max-w-2xl">
        A draft is written every Monday from what&rsquo;s on the site that week. Read it,
        change anything you like, and send it when you&rsquo;re happy.
        {mayS ? " Nothing goes out until you press send." : " An owner presses send."}
      </p>

      <AdminNotice n={n} />

      {/* ---------- the list ---------- */}
      <section className="grid gap-4 sm:grid-cols-3 mb-9">
        {[
          { n: counts.subscribed, l: "on the list", note: "people who ticked the box" },
          { n: counts.thisMonth, l: "joined this month", note: "in the last 30 days" },
          { n: counts.unsubscribed, l: "unsubscribed", note: "never emailed again" },
        ].map((s) => (
          <div key={s.l} className="card px-5 py-4">
            <p className="text-3xl tnum">{s.n}</p>
            <p className="text-sm font-semibold mt-1">{s.l}</p>
            <p className="text-xs text-ink-3 mt-0.5">{s.note}</p>
          </div>
        ))}
      </section>

      <div className="card px-5 py-4 mb-9 border-l-[3px] border-l-gold">
        <p className="text-sm">
          <b>This list only ever contains people who agreed on this website.</b>{" "}
          The previous supplier&rsquo;s customer export is deliberately not imported —
          permission given to them doesn&rsquo;t transfer to Varanasi, and emailing that
          list is how a restaurant ends up explaining itself to the ICO. It starts small
          and it is genuinely yours.
        </p>
      </div>

      {/* ---------- the draft ---------- */}
      <section className="mb-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h2 className="text-xl">
            {draft ? "This week's draft" : "No draft waiting"}
          </h2>
          <form action={regenerateDraft}>
            <button className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">
              {draft ? "Write a fresh draft" : "Write this week's draft"}
            </button>
          </form>
        </div>

        {!draft && (
          <p className="text-sm text-ink-3">
            One is prepared automatically on a Monday. Week of {weekOf()}.
          </p>
        )}

        {draft && (
          <div className="card">
            <form action={saveDraft} className="p-5 grid gap-4">
              <input type="hidden" name="id" value={draft.id} />

              <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
                <div>
                  <label className={label} htmlFor="subject">Subject line</label>
                  <input id="subject" name="subject" defaultValue={draft.subject}
                    className={field} required maxLength={140} />
                  <span className={hint}>
                    The only part most people read before deciding.
                  </span>
                </div>
                <div>
                  <label className={label} htmlFor="branchId">Who it&rsquo;s about</label>
                  <select id="branchId" name="branchId" defaultValue={draft.branchId ?? ""}
                    className={field}>
                    <option value="">Both restaurants</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <span className={hint}>Reaches {willReach} on the list.</span>
                </div>
              </div>

              <div>
                <label className={label} htmlFor="preheader">Preview line</label>
                <input id="preheader" name="preheader" defaultValue={draft.preheader ?? ""}
                  className={field} maxLength={200} />
                <span className={hint}>
                  Shown after the subject in most inboxes. Optional.
                </span>
              </div>

              <div>
                <label className={label} htmlFor="body">Message</label>
                <textarea id="body" name="body" defaultValue={draft.body}
                  className={field} rows={18} required />
                <span className={hint}>
                  Plain text — it&rsquo;s laid out properly when it&rsquo;s sent. A line in
                  CAPITALS on its own becomes a heading, and <code>{"{{name}}"}</code> becomes
                  the person&rsquo;s first name.
                </span>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button className="bg-ink text-pale px-5 py-2.5 text-sm font-semibold">
                  Save draft
                </button>
              </div>
            </form>

            <div className="border-t border-[--line] px-5 py-4 flex flex-wrap items-center gap-3">
              {mayS ? (
                <form action={send}>
                  <input type="hidden" name="id" value={draft.id} />
                  <ConfirmButton
                    ask={`Send this to ${willReach} ${willReach === 1 ? "person" : "people"}? `
                      + "It cannot be recalled. Save your changes first if you have made any."}
                    className="btn btn-ink !py-2.5 !px-6 text-xs">
                    Send to {willReach}
                  </ConfirmButton>
                </form>
              ) : (
                <p className="text-sm text-ink-3">
                  Ready to go. An owner presses send.
                </p>
              )}

              <form action={cancelDraft}>
                <input type="hidden" name="id" value={draft.id} />
                <ConfirmButton
                  ask="Discard this draft? Nothing is sent, and this week's draft is gone."
                  className="text-xs border border-[--line] px-3 py-1.5 hover:bg-pale">
                  Discard
                </ConfirmButton>
              </form>

              <p className="text-xs text-ink-3 basis-full">
                Prepared by {draft.preparedBy ?? "the system"} &middot; last changed {when(draft.updatedAt)}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ---------- history ---------- */}
      <section className="mb-10">
        <h2 className="text-xl mb-3">What has gone out</h2>
        {!history.length ? (
          <p className="text-sm text-ink-3">Nothing has been sent yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[36rem]">
              <thead className="text-left text-ink-3 bg-pale/60">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Subject</th>
                  <th className="px-4 py-2.5 font-semibold">Who</th>
                  <th className="px-4 py-2.5 font-semibold">Sent</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Reached</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id} className="border-t border-[--line] align-top">
                    <td className="px-4 py-2.5">
                      {c.subject}
                      <span className={`ml-2 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest ${STATUS[c.status] ?? ""}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-3">{branchName(c.branchId)}</td>
                    <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap">{when(c.sentAt)}</td>
                    <td className="px-4 py-2.5 text-right tnum">
                      {c.status === "sent" ? c.recipientCount : "—"}
                      {c.failedCount > 0 && (
                        <span className="block text-xs text-brick">{c.failedCount} refused</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- newest consents ---------- */}
      <section>
        <h2 className="text-xl mb-1">Most recent to join</h2>
        <p className="text-sm text-ink-3 mb-3">
          The wording each person agreed to is kept with their record, so the restaurant can
          always show what they said yes to.
        </p>
        {!newest.length ? (
          <p className="text-sm text-ink-3">
            Nobody yet. The first will arrive with the next booking or enquiry where the
            box is ticked.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[34rem]">
              <thead className="text-left text-ink-3 bg-pale/60">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Who</th>
                  <th className="px-4 py-2.5 font-semibold">From</th>
                  <th className="px-4 py-2.5 font-semibold">Agreed</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {newest.map((c) => (
                  <tr key={c.id} className="border-t border-[--line]">
                    <td className="px-4 py-2.5">
                      {c.name ?? <span className="text-ink-3">—</span>}
                      <span className="block text-xs text-ink-3">{c.email}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-3 capitalize">{c.source}</td>
                    <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap">{when(c.consentedAt)}</td>
                    <td className="px-4 py-2.5">
                      {c.unsubscribedAt ? (
                        <span className="text-brick">Unsubscribed</span>
                      ) : (
                        <span className="text-leaf">On the list</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
