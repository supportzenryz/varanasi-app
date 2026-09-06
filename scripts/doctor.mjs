/* What this machine is actually set up to do — one command, plain answers.
 *
 *   npm run doctor
 *   npm run doctor VB-963F21     (also: is this booking in that database?)
 *
 * Written after a booking reference reached Stripe and then could not be found
 * on the way back, and three rounds of fixes were aimed at the wrong thing
 * because the one fact that mattered was invisible: which file the server is
 * using. DATABASE_URL is a relative path, so it depends on the directory the
 * server was started from, and two terminals opened in different folders are
 * two different databases.
 *
 * Everything here is read-only. It prints no keys — only whether each is
 * present, its length and its first few characters, which is enough to tell a
 * test key from a live one and a pasted-with-a-newline key from a clean one.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { imageSize } from "./image-size.mjs";

/* .env.local is loaded by Next, not by node, so read it ourselves. Values
   already in the environment win, exactly as Next treats them. */
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k] !== undefined) continue;
      process.env[k] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
}

const bold = (s) => `[1m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const green = (s) => `[32m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

loadEnv();

const problems = [];
const say = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);

console.log(`\n${bold("Varanasi — what this setup is actually doing")}`);
console.log(dim(`  run from ${process.cwd()}\n`));

/* ---------- the database ---------- */
console.log(bold("Database"));
const configured = process.env.DATABASE_URL ?? "(unset)";
const raw = (process.env.DATABASE_URL ?? "").trim();
const file = raw ? (raw.startsWith("file:") ? raw.slice(5) || "./data/varanasi.db" : raw) : "./data/varanasi.db";
const resolved = path.resolve(file);

say("DATABASE_URL", configured);
say("resolves to", bold(resolved));
if (!path.isAbsolute(file)) {
  console.log(dim(`  ${" ".repeat(22)} relative — this answer changes with the folder you start the server in`));
}

let db = null;
let readable = true;
if (!fs.existsSync(resolved)) {
  say("the file", red("does not exist"));
  problems.push("The database file does not exist. Run: npm run db:ensure");
} else {
  const stat = fs.statSync(resolved);
  say("size / last written", `${(stat.size / 1024).toFixed(0)}KB · ${stat.mtime.toLocaleString("en-GB")}`);
  try {
    db = new DatabaseSync(resolved, { readOnly: true });
    let failures = 0;
    const counts = ["branches", "menu_items", "bookings", "vouchers", "enquiries", "private_rooms"]
      .map((t) => {
        try {
          return `${db.prepare(`select count(*) as n from ${t}`).get().n} ${t.replace("_", " ")}`;
        } catch (err) {
          failures++;
          return red(`${t} ${/i\/o|locking|readonly/i.test(err.message) ? "UNREADABLE" : "MISSING"}`);
        }
      });
    say("holds", counts.join(" · "));
    /* Every table failing is not a broken database — it is a file this process
       cannot read. Say so, loudly, because the alternative reading ("the data
       is gone") sends people looking for a disaster that has not happened. */
    if (failures === counts.length) {
      readable = false;
      console.log(red("\n  None of the tables could be read. That is a problem with reading the FILE,"));
      console.log(red("  not with the data in it."));
      console.log(dim("  SQLite needs proper file locking. Run this from a normal local terminal on the"));
      console.log(dim("  machine that holds the file — not over a network share, a mapped drive or a"));
      console.log(dim("  syncing folder, and not while another tool has the file open."));
      problems.push("The database could not be read at all. Run this locally, on the machine holding the file.");
    }
  } catch (err) {
    say("could not open it", red(err.message));
    problems.push(`Could not open the database: ${err.message}`);
  }
}

/* Every other copy of this project on the machine, and what its database holds.
   Two copies is the situation this whole script exists for. */
const siblings = [];
const parent = path.dirname(process.cwd());
try {
  for (const name of fs.readdirSync(parent)) {
    const candidate = path.join(parent, name);
    if (candidate === process.cwd()) continue;
    const theirs = path.join(candidate, "data", "varanasi.db");
    if (fs.existsSync(path.join(candidate, "package.json")) && fs.existsSync(theirs)) {
      siblings.push(theirs);
    }
  }
} catch { /* not worth failing over */ }

if (siblings.length) {
  console.log(`\n${bold("Another copy of the project is on this machine")}`);
  for (const s of siblings) {
    let n = "?";
    try {
      const other = new DatabaseSync(s, { readOnly: true });
      n = other.prepare("select count(*) as n from bookings").get().n;
      other.close();
    } catch { /* leave as ? */ }
    say("also here", `${s}  ${dim(`(${n} bookings)`)}`);
  }
  console.log(dim("  If you started the server from there, its bookings go there — not to the file above."));
}

/* ---------- a specific booking ---------- */
const wanted = process.argv[2];
if (wanted && db) {
  console.log(`\n${bold(`Booking ${wanted}`)}`);
  let row;
  try {
    row = db.prepare(
      "select reference,status,deposit_status,deposit_pence,date,time,party_size,email,stripe_session_id from bookings where upper(reference) = upper(?)",
    ).get(wanted.trim());
  } catch (err) {
    /* Not "the booking is missing" — "the file could not be read". The two look
       identical from the outside and are opposite conclusions, and mistaking
       one for the other is exactly how this script came to exist. SQLite needs
       real file locking, which network drives, mapped shares and syncing
       folders often do not provide, and it fails as a disk I/O error rather
       than as anything that mentions the drive. */
    console.log(red(`  Could not read the database: ${err.message}`));
    console.log(dim("  This is a problem reading the FILE, not evidence about the booking."));
    console.log(dim("  SQLite needs proper file locking. Run this from a normal local terminal on"));
    console.log(dim("  the machine that holds the file — not over a network share, a mapped drive"));
    console.log(dim("  or a syncing folder, and not while another tool has the file open."));
    problems.push(`The database could not be read (${err.message}). Run this locally, on the machine holding the file.`);
    row = undefined;
    db = null;
  }
  if (row) {
    for (const [k, v] of Object.entries(row)) say(k, v === null ? dim("null") : String(v));
    if (row.deposit_status === "captured") console.log(green("\n  This booking is paid and confirmed."));
    else console.log(red(`\n  Deposit status is "${row.deposit_status}" — not confirmed.`));
  } else if (readable) {
    console.log(red("  Not in this database."));
    console.log(dim("  The booking row is written BEFORE the Stripe payment page is created, so a"));
    console.log(dim("  reference that reached Stripe was written somewhere. If it is not here, the"));
    console.log(dim("  server that took it was using a different file — see the paths above."));
    problems.push(`${wanted} is not in ${resolved}. The server that created it used a different database.`);
  }
}

/* ---------- payments ---------- */
console.log(`\n${bold("Payments")}`);
const sk = process.env.STRIPE_SECRET_KEY ?? "";
if (!sk) {
  say("Stripe", "not configured — the built-in simulator will be used");
} else {
  const mode = sk.startsWith("sk_live") ? red("LIVE") : sk.startsWith("sk_test") ? "test" : red("unrecognised");
  say("secret key", `${mode} · ${sk.length} chars · starts ${sk.slice(0, 8)}…`);
  if (/\s/.test(sk)) problems.push("STRIPE_SECRET_KEY contains a space or newline — it was probably pasted with one.");
  const wh = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  say("webhook secret", wh ? `${wh.length} chars · starts ${wh.slice(0, 6)}…` : red("not set"));
  if (!wh) {
    problems.push(
      "STRIPE_WEBHOOK_SECRET is not set. The return page still confirms a booking, but if a "
      + "guest closes the tab while paying, nothing confirms it and they hear nothing.",
    );
  }
}
say("SITE_URL", process.env.SITE_URL ?? red("not set — defaults to http://localhost:3000"));

/* ---------- email ---------- */
console.log(`\n${bold("Email")}`);
const resendKey = process.env.RESEND_API_KEY ?? "";
const mode = resendKey ? "resend" : process.env.MAIL_WEBHOOK_URL ? "webhook" : "outbox";
say("sending via", mode === "outbox" ? "data/outbox (nothing is actually posted)" : mode);

let fromEmail = process.env.MAIL_FROM ?? null;
try {
  const rules = JSON.parse(fs.readFileSync("data/booking.json", "utf8"));
  fromEmail = rules?.notifications?.fromEmail ?? fromEmail;
} catch { /* fall back to the env value */ }
say("from address", fromEmail ?? "reservations@varanasi.uk");

if (mode === "resend") {
  const domain = String(fromEmail ?? "").split("@")[1] ?? "";
  if (domain && domain !== "resend.dev") {
    console.log(dim(`  ${" ".repeat(22)} Resend refuses this unless ${domain} is verified on the account.`));
    console.log(dim(`  ${" ".repeat(22)} Admin → Settings → "Send me a test email" asks it and shows the answer.`));
  }
}

const outbox = "data/outbox";
if (fs.existsSync(outbox)) {
  const files = fs.readdirSync(outbox).sort().reverse();
  const undelivered = files.filter((f) => f.includes("UNDELIVERED"));
  say("outbox", `${files.length} file(s)${undelivered.length ? red(` · ${undelivered.length} UNDELIVERED`) : ""}`);
  if (files[0]) say("most recent", dim(files[0]));
  if (undelivered.length) {
    problems.push(`${undelivered.length} email(s) were refused by the provider — see data/outbox/*UNDELIVERED*`);
  }
}

/* ---------- photography ---------- */
if (db) {
  try {
    const small = db.prepare("select count(*) as n from gallery_images where width is not null and width < 1200").get().n;
    const unmeasured = db.prepare("select count(*) as n from gallery_images where width is null").get().n;
    console.log(`\n${bold("Photography")}`);
    say("under 1200px wide", `${small} — shown at tile size only`);
    if (unmeasured) {
      say("not yet measured", `${unmeasured} ${dim("(measured automatically on the next start)")}`);
    }
    void imageSize;
  } catch { /* the column may predate the migration */ }
}

if (db) db.close();

/* ---------- the verdict ---------- */
console.log("");
if (problems.length) {
  console.log(bold(red(`${problems.length} thing${problems.length > 1 ? "s" : ""} to look at:`)));
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
} else {
  console.log(green("Nothing obviously wrong."));
}
console.log("");
