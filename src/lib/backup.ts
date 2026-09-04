import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath } from "@/db";

/**
 * Daily backups of the trading data.
 *
 * There were none. A restaurant taking card deposits and selling gift
 * vouchers was running on one SQLite file on one volume, and the only thing
 * resembling a backup was an unticked checkbox in DEPLOYMENT.md. Vouchers are
 * the sharp end of that: a guest pays £100, receives a code, and the sole
 * record that the debt exists is that file. Lose it and there are customers
 * holding valid claims that nothing can verify.
 *
 * `VACUUM INTO` rather than copying the file. A plain copy of a live SQLite
 * database can catch it mid-write, with a write-ahead log that has not been
 * checkpointed — the copy looks fine, is the right size, and fails to open
 * when it is finally needed, which is the worst possible time to find out.
 * VACUUM INTO takes a consistent snapshot through SQLite itself and writes a
 * clean, already-compacted database.
 *
 * WHAT THIS DOES AND DOES NOT PROTECT AGAINST — worth being exact, because a
 * backup that quietly protects against less than you assume is worse than
 * none:
 *
 *   Covered:     a bad migration, a mistaken bulk delete, table corruption,
 *                a deploy that wipes the app, someone clearing data by hand.
 *   NOT covered: the loss of the volume itself. These files live beside the
 *                database, so whatever destroys one destroys the other.
 *
 * Closing that gap needs a copy somewhere else, which is why the admin can
 * download one and why BACKUPS.md explains the offsite step. Automating it is
 * worth doing; pretending the local copies are already enough is not.
 */

const KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const EVERY_HOURS = Number(process.env.BACKUP_EVERY_HOURS ?? 24);

export type BackupFile = { name: string; path: string; bytes: number; at: Date };

/** Beside the database, so it lands on the mounted volume rather than in the
 *  container image — where it would vanish on the next deploy. */
export function backupDir(): string {
  return path.join(path.dirname(databasePath()), "backups");
}

export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((name) => {
      const p = path.join(dir, name);
      const s = fs.statSync(p);
      return { name, path: p, bytes: s.size, at: s.mtime };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type BackupResult =
  | { ok: true; file: string; bytes: number; pruned: number }
  | { ok: false; error: string };

export function runBackup(reason = "scheduled"): BackupResult {
  const source = databasePath();
  const dir = backupDir();

  try {
    if (!fs.existsSync(source)) return { ok: false, error: `no database at ${source}` };
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const target = path.join(dir, `varanasi-${stamp}.db`);

    const db = new DatabaseSync(source);
    try {
      // The path is interpolated rather than bound because VACUUM INTO does
      // not accept a parameter. It is built here from a timestamp, never from
      // user input, and the quote-doubling keeps that true if it ever changes.
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    // Prove it opens and has the tables in it. A backup nobody has read is a
    // hope, not a backup — and the failure mode that matters is discovering
    // at restore time that every file is unreadable.
    const check = new DatabaseSync(target);
    let bookings = 0;
    try {
      const row = check
        .prepare("select count(*) as n from sqlite_master where type='table'")
        .get() as { n: number };
      if (!Number(row.n)) throw new Error("backup contains no tables");
      bookings = Number(
        (check.prepare("select count(*) as n from bookings").get() as { n: number }).n,
      );
    } finally {
      check.close();
    }

    const kept = listBackups();
    let pruned = 0;
    for (const old of kept.slice(KEEP)) {
      try {
        fs.unlinkSync(old.path);
        pruned++;
      } catch {
        /* a file we cannot remove is not a reason to fail the backup */
      }
    }

    const bytes = fs.statSync(target).size;
    console.log(
      `[backup] ${reason}: ${path.basename(target)} (${(bytes / 1024).toFixed(0)}KB, ` +
        `${bookings} bookings, verified)${pruned ? `, pruned ${pruned}` : ""}`,
    );
    return { ok: true, file: target, bytes, pruned };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[backup] FAILED (${reason}): ${error}`);
    return { ok: false, error };
  }
}

/** True when the newest backup is older than the interval — or there is none. */
function isDue(): boolean {
  const [newest] = listBackups();
  if (!newest) return true;
  return Date.now() - newest.at.getTime() >= EVERY_HOURS * 3600_000;
}

let started = false;

/**
 * Started once from src/instrumentation.ts.
 *
 * A timer inside the app process rather than a separate cron service: this
 * runs on a long-lived Node server, so a timer is enough, and a scheduler the
 * restaurant has to remember to configure is a scheduler that ends up not
 * configured. It backs up on boot when one is due, so a container that
 * restarts nightly still produces daily copies, and it checks hourly rather
 * than sleeping for a day so that a restart never resets the clock.
 */
export function startBackupSchedule(): void {
  if (started) return;
  started = true;

  const tick = () => {
    if (isDue()) runBackup("scheduled");
  };

  setTimeout(tick, 30_000).unref?.();      // let the server finish booting first
  setInterval(tick, 3600_000).unref?.();   // then look every hour
  console.log(`[backup] daily backups on, keeping ${KEEP}, in ${backupDir()}`);
}
