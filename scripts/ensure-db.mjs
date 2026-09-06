/* Prepares the database the *running* container will actually use.
 *
 * This has to happen at start, not at build, and the reason is the volume.
 * The build seeds a database into the image at ./data, and then the host mounts
 * a persistent volume over that same path — so the file the build so carefully
 * populated is hidden the moment the container starts, and the app comes up
 * against an empty directory. Everything below therefore runs against the
 * mounted volume, once, on the way up.
 *
 * The seed is deliberate about what it will and will not do. It opens with
 * `delete from menu_items; delete from users; ...`, which is right for a fresh
 * install and catastrophic on the fifth deploy: the client's menu edits, their
 * staff's changed passwords and their settings would all go back to the
 * shipped defaults every time anyone pushed. So it runs only when the database
 * has no branches in it — the honest test for "nothing has happened here yet".
 *
 * Migrations are different and run every time: they are additive, they are
 * idempotent by construction, and a schema change in a release has to reach an
 * existing database or the new code meets the old tables.
 */
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "./image-size.mjs";

/** Hosts hand this over as a connection string; SQLite wants a path. */
function databasePath(raw = process.env.DATABASE_URL) {
  const v = (raw ?? "").trim();
  if (!v) return "./data/varanasi.db";
  return v.startsWith("file:") ? v.slice("file:".length) || "./data/varanasi.db" : v;
}

const file = databasePath();
fs.mkdirSync(path.dirname(file), { recursive: true });

// Hand the resolved path down, so migrate and seed cannot disagree with the
// app about which file is the database.
const env = { ...process.env, DATABASE_URL: file };

function run(label, script) {
  const r = spawnSync(process.execPath, [script], { stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`\n[ensure-db] ${label} failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

/** True when the database has no content of its own yet. */
function isEmpty() {
  if (!fs.existsSync(file)) return true;
  const db = new DatabaseSync(file);
  try {
    const t = db
      .prepare("select count(*) as n from sqlite_master where type='table' and name='branches'")
      .get();
    if (!Number(t.n)) return true;
    return Number(db.prepare("select count(*) as n from branches").get().n) === 0;
  } catch {
    return true;
  } finally {
    db.close();
  }
}

console.log(`[ensure-db] database: ${file}`);

const fresh = isEmpty();
run("migrate", "scripts/migrate.mjs");

if (fresh) {
  console.log("[ensure-db] empty database — seeding starting content.");
  run("seed", "scripts/seed.mjs");
} else {
  console.log("[ensure-db] existing data found — skipping seed (it would erase live edits).");
  backfillGalleryDimensions();
}

console.log("[ensure-db] ready.");

/**
 * Fill in the pixel sizes of gallery photographs added before the columns for
 * them existed.
 *
 * A migration can add a column but it cannot know what belongs in it, and the
 * seed — which does know, because it reads the files — is precisely what must
 * not run against a database the client has been using. Between those two the
 * live gallery would have kept every row's size null, and the layout treats
 * null as "large enough to enlarge", which is the behaviour that put a 201px
 * thumbnail across the full width of the page. So the one gap gets closed here,
 * on the way up.
 *
 * Only rows with nothing recorded are touched, and a file that cannot be read —
 * a photograph on a CDN rather than in `public`, or one an editor has since
 * removed — is left as it was. Running this again does nothing.
 */
function backfillGalleryDimensions() {
  const db = new DatabaseSync(file);
  try {
    const has = db.prepare(
      "select count(*) as n from pragma_table_info('gallery_images') where name = 'width'",
    ).get();
    if (!Number(has.n)) return;

    const rows = db.prepare(
      "select id, src from gallery_images where width is null and src like '/%'",
    ).all();
    if (!rows.length) return;

    const update = db.prepare("update gallery_images set width = ?, height = ? where id = ?");
    let filled = 0;
    for (const row of rows) {
      const size = imageSize(path.join("public", row.src));
      if (!size) continue;
      update.run(size.width, size.height, row.id);
      filled++;
    }
    if (filled) console.log(`[ensure-db] measured ${filled} gallery photograph(s).`);
  } catch (err) {
    // Never block a boot over a layout nicety.
    console.warn(`[ensure-db] could not measure gallery photographs: ${err.message}`);
  } finally {
    db.close();
  }
}
