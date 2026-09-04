import { requireAbility } from "@/lib/auth";
import { listBackups, backupDir } from "@/lib/backup";
import { backupNow } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups" };

const KB = (b: number) => `${(b / 1024).toFixed(0)} KB`;
const when = (d: Date) =>
  d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function BackupsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; failed?: string }>;
}) {
  await requireAbility("manageBackups");
  const sp = await searchParams;
  const files = listBackups();
  const newest = files[0];
  const stale = !newest || Date.now() - newest.at.getTime() > 36 * 3600_000;

  return (
    <>
      <h1 className="text-3xl">Backups</h1>
      <p className="text-ink-3 mt-2 max-w-[70ch]">
        A copy of everything the restaurant has recorded — bookings, deposits, gift vouchers and
        their balances, enquiries and menus — taken automatically once a day.
      </p>

      {sp.done && (
        <p role="status" className="mt-6 border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
          Backup taken and checked. It opens and the tables are all there.
        </p>
      )}
      {sp.failed && (
        <p role="alert" className="mt-6 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm">
          The backup failed: {sp.failed}
        </p>
      )}

      {/* The state that actually matters, said plainly rather than left for
          someone to work out from a list of filenames. */}
      <div className={`mt-6 border-l-2 px-4 py-3 text-sm ${stale ? "border-brick bg-clay/10" : "border-gold bg-gold/10"}`}>
        {newest
          ? stale
            ? <>The most recent backup is from <strong>{when(newest.at)}</strong> — more than a day old. Take one now, and tell whoever looks after the site.</>
            : <>Last backup <strong>{when(newest.at)}</strong>. {files.length} kept.</>
          : <>There is <strong>no backup yet</strong>. Take one now.</>}
      </div>

      <form action={backupNow} className="mt-5">
        <button className="bg-ink text-pale px-6 py-3 text-sm font-semibold">Back up now</button>
      </form>

      {/* Being straight about the limit of these copies. They protect against
          the likely accidents and not against losing the disk, and an owner
          who believes otherwise is worse off than one who knows. */}
      <div className="mt-8 border border-[--line] bg-white p-5 max-w-[70ch]">
        <h2 className="font-semibold">Keeping a copy somewhere else</h2>
        <p className="text-sm text-ink-3 mt-2 leading-relaxed">
          These backups sit on the same disk as the live database. They will bring the restaurant
          back from a mistaken deletion or a bad update, but not from the loss of that disk.
          Download one now and again — monthly is plenty — and keep it somewhere separate.
          Gift vouchers are the reason: a guest who paid for one is owed it, and this file is the
          only proof of what is outstanding.
        </p>
      </div>

      <h2 className="text-xl mt-10">Available backups</h2>
      {files.length === 0 ? (
        <p className="text-ink-3 mt-3">None yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[34rem]">
            <thead>
              <tr className="text-left border-b border-[--line]">
                <th className="py-2 pr-4 font-semibold">Taken</th>
                <th className="py-2 pr-4 font-semibold">Size</th>
                <th className="py-2 font-semibold">Download</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name} className="border-b border-[--line]">
                  <td className="py-2.5 pr-4">{when(f.at)}</td>
                  <td className="py-2.5 pr-4 tnum text-ink-3">{KB(f.bytes)}</td>
                  <td className="py-2.5">
                    <a href={`/admin/backups/download?file=${encodeURIComponent(f.name)}`}
                      className="text-gold-ink font-semibold hover:underline">
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-3 mt-6 break-words">Stored in {backupDir()}</p>
    </>
  );
}
