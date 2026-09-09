#!/usr/bin/env node
/**
 * Set a staff password, or add an account, from a terminal.
 *
 * Written because there was no way back in. The admin can reset anyone's
 * password — except that resetting it requires being signed in, and the seeded
 * owner's password is meant to be changed on first use. Change it, forget it,
 * and the only door to the site's own back office is locked from the inside:
 * "ask an owner to reset it from Staff access" is no help when you are the
 * owner.
 *
 *   npm run staff:password -- sathish@zenryz.com
 *   npm run staff:password -- sathish@zenryz.com --create --role owner
 *   npm run staff:password -- birmingham@varanasi.uk --create --role manager --branch birmingham
 *
 * The password is typed at a prompt with the echo turned off, twice. It is
 * never an argument, because an argument goes into the shell history, into the
 * process list while it runs, and into any terminal recording — and this one
 * opens the whole back office.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { passwordComplaint, BCRYPT_COST } from "../src/lib/password-rules.mjs";

/* .env.local, read the same way the app reads it, so this script and the
   server always agree about which database they are talking about. */
for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const email = argv.find((a) => a.includes("@"))?.toLowerCase();

const ROLES = ["owner", "manager", "staff"];
const bold = (s) => `[1m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const green = (s) => `[32m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

function die(message) {
  console.error(`\n${red(message)}\n`);
  process.exit(1);
}

if (!email) {
  die(`Which account? Give the email address.\n\n`
    + `  npm run staff:password -- owner@varanasi.uk\n`
    + `  npm run staff:password -- you@example.com --create --role owner\n\n`
    + `Options: --create  make the account if it does not exist\n`
    + `         --role    owner | manager | staff   (default owner, with --create)\n`
    + `         --branch  a branch slug, for a manager who runs one restaurant`);
}

const dbFile = path.resolve(process.env.DATABASE_URL ?? "./data/varanasi.db");
if (!fs.existsSync(dbFile)) die(`No database at ${dbFile}. Run: npm run db:ensure`);
const db = new DatabaseSync(dbFile);

console.log(`\n${bold("Varanasi — set a staff password")}`);
console.log(dim(`  database  ${dbFile}`));

const user = db.prepare("select id, email, name, role, is_active from users where lower(email) = ?").get(email);

let role = (value("role") ?? "owner").toLowerCase();
let branchId = null;

if (!user) {
  if (!flag("create")) {
    const known = db.prepare("select email, role from users order by id").all();
    die(`There is no account for ${email}.\n\n`
      + `Accounts in this database:\n`
      + known.map((u) => `  ${u.email}  ${dim(u.role)}`).join("\n")
      + `\n\nTo add ${email} as a new account, repeat the command with --create.`);
  }
  if (!ROLES.includes(role)) die(`--role has to be one of: ${ROLES.join(", ")}`);
  const slug = value("branch");
  if (slug) {
    const branch = db.prepare("select id, city from branches where slug = ?").get(slug);
    if (!branch) {
      const all = db.prepare("select slug from branches").all().map((b) => b.slug).join(", ");
      die(`No branch with the slug "${slug}". Branches here: ${all}`);
    }
    branchId = branch.id;
  }
  console.log(`  ${green("new account")}  ${email} as ${role}${branchId ? ` for ${value("branch")}` : ""}`);
} else {
  role = user.role;
  console.log(`  account   ${user.email}  ${dim(`${user.name} · ${role}${user.is_active ? "" : " · SUSPENDED"}`)}`);
}

/* Two ways in, because a password prompt has to work in both.
 *
 * At a terminal: readline with the echo suppressed, asked twice.
 * Piped (`printf 'pw\npw\n' | npm run staff:password -- …`, or from another
 * script): read the lines from stdin. Still not an argument, so still not in
 * the shell history or the process list.
 *
 * This began as two readline interfaces, one per question, which hung for ever
 * on the second: closing the first detaches the shared stdin. One interface,
 * and only when there is a terminal to attach it to. */
const interactive = Boolean(process.stdin.isTTY);
const piped = interactive ? [] : fs.readFileSync(0, "utf8").split(/\r?\n/);
const rl = interactive
  ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  : null;

/** Ask, with nothing appearing on screen as it is typed. */
function secret(prompt) {
  if (!rl) {
    const line = piped.shift();
    if (line === undefined) die("  Ran out of input. Piped use expects the password on two lines.");
    process.stdout.write(`${prompt}\n`);
    return Promise.resolve(line);
  }
  return new Promise((resolve) => {
    let shown = false;
    // `_writeToOutput` is how a hidden prompt is done without a dependency:
    // print the prompt once, then swallow every echoed keystroke.
    rl._writeToOutput = (chunk) => {
      if (!shown) { rl.output.write(prompt); shown = true; }
      else if (chunk.includes("\n")) rl.output.write("\n");
    };
    rl.question(prompt, resolve);
  });
}

/* The rules themselves live in src/lib/password-rules.mjs, imported above.
   This comment used to say "the same rules the admin's own password form
   applies" — and it was not true: the form asked for ten characters of
   anything while this asked for twelve with mixed case. A back door with a
   different lock from the front one is how a policy quietly stops meaning
   anything, so there is now one module and no second copy. */

const first = await secret("\n  New password (nothing will appear as you type): ");
const wrong = passwordComplaint(first, { email });
if (wrong) die(`  ${wrong}`);
const again = await secret("  Type it once more: ");
if (first !== again) die("  Those two did not match. Nothing has been changed.");

const hash = bcrypt.hashSync(first, BCRYPT_COST);
const now = Math.floor(Date.now() / 1000);

if (user) {
  db.prepare("update users set password_hash = ?, must_change_password = 0, is_active = 1 where id = ?")
    .run(hash, user.id);
  console.log(`\n${green("Done.")} Sign in at /admin/login as ${bold(user.email)}.`);
  if (!user.is_active) console.log(dim("  The account was suspended; it has been reactivated."));
} else {
  db.prepare(`insert into users (email, password_hash, name, role, branch_id, is_active, must_change_password)
              values (?, ?, ?, ?, ?, 1, 0)`)
    .run(email, hash, value("name") ?? email.split("@")[0], role, branchId);
  db.prepare(`insert into audit_log (action, entity, entity_id, detail, created_at)
              values (?, ?, ?, ?, ?)`)
    .run("staff.create", "user", email, `${email} created from the command line as ${role}`, now);
  console.log(`\n${green("Created.")} Sign in at /admin/login as ${bold(email)}.`);
}

console.log(dim("  The password was never written to a file, an argument or the history.\n"));
db.close();
rl?.close();
