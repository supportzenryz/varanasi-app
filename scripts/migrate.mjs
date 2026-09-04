/* Applies the Drizzle migrations with Node's built-in SQLite — no native module.
 *
 * Three things this has to survive, all learned the hard way:
 *
 * 1. Orphaned migration files. Unzipping a new build over an old folder
 *    overwrites files but never deletes the ones that went away, so a
 *    superseded `0000_*.sql` can still be sitting in drizzle/. We apply only
 *    what `drizzle/meta/_journal.json` lists, in its order — the same thing
 *    Drizzle's own migrator does — and name any stray files we ignore.
 *
 * 2. Databases created before this script tracked anything. Those have the
 *    right tables but no `__migrations` row to prove it. Rather than replaying
 *    migration 0 over a populated database (which fails on "table already
 *    exists"), we recognise the shape, adopt it as a baseline, and carry on
 *    with the migrations that follow.
 *
 * 3. Real data. Bookings, deposits and audit history now live in here, so the
 *    old "move it aside and rebuild" shortcut is a last resort, not a habit.
 *    It only happens when the file is too old to reconcile, it never deletes
 *    anything, and it says loudly what it did.
 *
 * Running this twice is a no-op.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/** Hosts hand DATABASE_URL over as `file:/data/x.db`; SQLite wants a path. */
const rawUrl = (process.env.DATABASE_URL ?? "").trim();
const file = rawUrl
  ? (rawUrl.startsWith("file:") ? rawUrl.slice(5) || "./data/varanasi.db" : rawUrl)
  : "./data/varanasi.db";
const dir = "./drizzle";
fs.mkdirSync(path.dirname(file), { recursive: true });

/** The migrations that belong to this build, in order. */
function plannedMigrations() {
  const journalPath = path.join(dir, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
  const planned = [];
  for (const e of entries) {
    const name = `${e.tag}.sql`;
    if (!fs.existsSync(path.join(dir, name))) {
      console.error(`missing migration named in the journal: ${name}`);
      process.exit(1);
    }
    planned.push(name);
  }
  const orphans = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && !planned.includes(f));
  if (orphans.length) {
    console.log(`ignoring ${orphans.length} migration file(s) not in the journal: ${orphans.join(", ")}`);
    console.log("(left over from an earlier build — safe to delete)");
  }
  return planned;
}

/** Does this table have this column? */
function hasColumn(db, table, column) {
  try {
    return db.prepare(`pragma table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}
function hasTable(db, table) {
  try {
    return Boolean(db.prepare("select name from sqlite_master where type='table' and name=?").get(table));
  } catch {
    return false;
  }
}

/**
 * Columns that prove a database is at least as new as migration 0000. An
 * untracked database with all of these is adopted as a 0000 baseline; one
 * without them predates the current schema and can't be reconciled.
 */
const BASELINE = [
  ["menu_items", "measure"],
  ["menu_categories", "kind"],
  ["private_rooms", "hire_charge_pence"],
  ["branches", "hero_video"],
  ["branch_stats", "label"],
  ["gallery_images", "src"],
];

const planned = plannedMigrations();
const firstTag = planned[0]?.replace(/\.sql$/, "");

/* ---- decide what we're dealing with before opening anything for writing ---- */
let mode = "fresh";           // fresh | incremental | adopt | rebuild
if (fs.existsSync(file)) {
  const probe = new DatabaseSync(file);
  try {
    if (hasTable(probe, "__migrations")) {
      mode = "incremental";
    } else if (BASELINE.every(([t, c]) => hasColumn(probe, t, c))) {
      mode = "adopt";
    } else {
      mode = "rebuild";
    }
  } finally {
    probe.close();
  }
}

if (mode === "rebuild") {
  const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, backup + suffix);
  }
  console.log(`! this database predates the current schema and can't be migrated in place`);
  console.log(`! it has been moved to ${path.basename(backup)} — nothing was deleted`);
  console.log(`! run "npm run db:seed" afterwards to repopulate`);
}

const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON");
db.exec("create table if not exists __migrations (tag text primary key, applied_at integer not null)");

const record = db.prepare("insert or ignore into __migrations (tag, applied_at) values (?, ?)");
const stamp = () => Math.floor(Date.now() / 1000);

if (mode === "adopt" && firstTag) {
  // The tables are already here from a build that didn't record migrations.
  // Adopt them as the baseline so we apply what came after, not what's done.
  record.run(firstTag, stamp());
  console.log(`adopted the existing database as "${firstTag}" (it already has that schema)`);
}

const done = new Set(db.prepare("select tag from __migrations").all().map((r) => r.tag));

let applied = 0;
for (const name of planned) {
  const tag = name.replace(/\.sql$/, "");
  if (done.has(tag)) {
    console.log("skipped (already applied)", name);
    continue;
  }
  const sql = fs.readFileSync(path.join(dir, name), "utf8");
  try {
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) db.exec(s);
    }
  } catch (err) {
    console.error(`\nfailed applying ${name}: ${err.message}`);
    console.error("nothing further was applied; the database is unchanged by this migration.");
    db.close();
    process.exit(1);
  }
  record.run(tag, stamp());
  applied++;
  console.log("applied", name);
}
db.close();

console.log(applied ? `migrated -> ${file} (${applied} applied)` : `up to date -> ${file}`);
if (mode === "fresh" || mode === "rebuild") console.log("next: npm run db:seed");
