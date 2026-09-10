/* Getting in, and getting back in.
 *
 * The password rules, the forgotten-password link, and the throttle that sits
 * in front of the sign-in form — against a throwaway database with the real
 * migrations applied and the shipped code.
 *
 * Why each of these is here:
 *
 *   - the web form and the terminal tool used to enforce different password
 *     rules, and the weaker one guarded the front door: "type the shared
 *     starting password again" satisfied the forced first-time change;
 *   - a reset link is a way into every guest's details, so single-use,
 *     expiry, and "asking again cancels the old one" all have to be true and
 *     not merely intended;
 *   - the sign-in throttle used to live in memory, so every deploy forgave
 *     every attacker.
 *
 *   npm run test:auth
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", new URL(".", import.meta.url));

/* Windows.
 *
 * Two things about `await import()` and paths, and both of them bite only on
 * Windows, which is where this project is actually developed:
 *
 *  - a dynamic import needs a `file://` URL, not a path. `await import("C:\\…")`
 *    is read as a URL with the scheme "c:" and refused outright
 *    (ERR_UNSUPPORTED_ESM_URL_SCHEME). `pathToFileURL(...).href` is the fix.
 *  - `new URL(".", …).pathname` is `/C:/Users/…`, with a leading slash, so
 *    joining it produces `C:\\C:\\Users\\…`. `fileURLToPath` is the fix.
 *
 * Neither shows up on Linux, so a suite written there passes and then fails on
 * the machine that matters. */
const projectRoot = fileURLToPath(new URL(".", root));
const dir = path.join(projectRoot, ".tmp-auth-test");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

/* The shipped modules, with the `@/` alias and the `server-only` guard
   rewritten and nothing else changed. `next/headers` and `next/navigation`
   only appear in the action files, which this suite does not load. */
function load(from: string, as: string) {
  const src = fs.readFileSync(new URL(from, root), "utf8");
  fs.writeFileSync(path.join(dir, as), src
    .replace(/^import "server-only";\s*$/m, "")
    .replace(/@\/db\/schema/g, "./schema")
    .replace(/from "@\/db"/g, 'from "./db"')
    .replace(/@\/lib\//g, "./")
    .replace(/\.\.\/\.\.\/data\//g, "../data/"));
}
load("src/db/schema.ts", "schema.ts");
load("src/db/sqlite.ts", "sqlite.ts");
load("src/db/index.ts", "db.ts");
for (const f of fs.readdirSync(new URL("src/lib/", root))) load(`src/lib/${f}`, f);

const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = dbFile;
process.env.SITE_URL = "https://example.test";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_WEBHOOK_URL;
delete process.env.TWILIO_ACCOUNT_SID;
process.chdir(dir);

{
  const raw = new DatabaseSync(dbFile);
  const journal = JSON.parse(fs.readFileSync(new URL("drizzle/meta/_journal.json", root), "utf8"));
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(new URL(`drizzle/${entry.tag}.sql`, root), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const text = stmt.trim();
      if (text) raw.exec(text);
    }
  }
  raw.exec(`insert into branches (slug, name, city, address_line, postcode, phone, sort)
            values ('birmingham','Varanasi Birmingham','Birmingham','1 Test Street','B1 1AA','0121 000 0000',1)`);
  raw.close();
}

const rules = await import(pathToFileURL(path.join(dir, "password-rules.mjs")).href);
const reset = await import(pathToFileURL(path.join(dir, "password-reset.ts")).href);
const limiter = await import(pathToFileURL(path.join(dir, "rate-limit.ts")).href);
const guard = await import(pathToFileURL(path.join(dir, "login-guard.ts")).href);
const { db, closeDatabase } = await import(pathToFileURL(path.join(dir, "db.ts")).href);
const schema = await import(pathToFileURL(path.join(dir, "schema.ts")).href);
const { eq } = await import("drizzle-orm");
const bcrypt = (await import("bcryptjs")).default;

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (ok) pass++; else fail++;
};

const OWNER = "owner@example.test";
db.insert(schema.users).values({
  email: OWNER,
  passwordHash: bcrypt.hashSync(rules.STARTING_STAFF_PASSWORD, 4),  // cost 4: this is a test
  name: "Test Owner",
  role: "owner",
  isActive: true,
  mustChangePassword: true,
}).run();

console.log("\n── The password rules ──");
{
  const refused: [string, string][] = [
    ["ChangeMe!2026", "the shared starting password"],
    ["Varanasi2026x", "built around the restaurant's name"],
    ["Short1Aa", "too short"],
    ["alllowercase1", "no capital"],
    ["ALLUPPERCASE1", "no small letter"],
    ["NoDigitsAtAll", "no number"],
    ["aaaaaaaaaaaaA1", "too few distinct characters"],
    ["abcdefghij1A", "a run along the keyboard"],
    ["  Padded1Word  ", "leading and trailing spaces"],
    ["ownerExample1Test", "built out of the account's own address"],
  ];
  for (const [pw, why] of refused) {
    const complaint = rules.passwordComplaint(pw, { email: OWNER, name: "Test Owner" });
    t(`refused: ${why}`, Boolean(complaint), complaint ? "" : `"${pw}" was accepted`);
  }
  const good = ["copper-Lantern-tuesday7", "Quiet7Rivers-Marmalade", "9Bicycles!inThe-Rain"];
  for (const pw of good) {
    const complaint = rules.passwordComplaint(pw, { email: OWNER, name: "Test Owner" });
    t(`accepted: a decent passphrase (${pw.slice(0, 8)}…)`, complaint === null, complaint ?? "");
  }
  t("the same rules module is what the terminal tool imports",
    fs.readFileSync(new URL("scripts/set-password.mjs", root), "utf8")
      .includes('from "../src/lib/password-rules.mjs"'));
}

console.log("\n── A forgotten-password link ──");

/** The link that was emailed. In this configuration mail goes to data/outbox
 *  as readable text, which is also how the restaurant can see what went out. */
function latestLink(): string | null {
  const outbox = path.join(dir, "data", "outbox");
  if (!fs.existsSync(outbox)) return null;
  const files = fs.readdirSync(outbox).filter((f) => f.includes("set-a-new-password")).sort();
  if (!files.length) return null;
  const body = fs.readFileSync(path.join(outbox, files[files.length - 1]), "utf8");
  return /https:\/\/example\.test\/admin\/reset\?token=([0-9a-f]{64})/.exec(body)?.[1] ?? null;
}

{
  const result = await reset.requestPasswordReset(OWNER, { ip: "1.2.3.4", siteUrl: "https://example.test" });
  t("a link is sent for a real account", result.sent);
  const token = latestLink();
  t("and the email contains a 64-character token", Boolean(token));

  t("the token itself is not stored anywhere", (() => {
    const rows = db.select().from(schema.passwordResets).all();
    return rows.length === 1 && rows[0].tokenHash !== token && rows[0].tokenHash.length === 64;
  })());

  t("the link checks out before use", reset.checkResetToken(token!).ok);
  t("a token that is one character different is refused",
    !reset.checkResetToken(token!.slice(0, 63) + (token![63] === "a" ? "b" : "a")).ok);
  t("a token of the wrong shape is refused", !reset.checkResetToken("not-a-token").ok);
  t("no token at all is refused", !reset.checkResetToken(undefined).ok);

  const weak = reset.resetPasswordWithToken(token!, "ChangeMe!2026", "ChangeMe!2026", "1.2.3.4");
  t("the link does not let you round the password rules", !weak.ok);
  const mismatch = reset.resetPasswordWithToken(token!, "copper-Lantern-tuesday7", "something-Else9", "1.2.3.4");
  t("two different passwords are refused", !mismatch.ok);
  t("and neither attempt spent the link", reset.checkResetToken(token!).ok);

  const done = reset.resetPasswordWithToken(token!, "copper-Lantern-tuesday7", "copper-Lantern-tuesday7", "1.2.3.4");
  t("a good password goes through", done.ok, done.ok ? "" : done.error);

  const row = db.select().from(schema.users).where(eq(schema.users.email, OWNER)).get();
  t("the new password is what is stored",
    bcrypt.compareSync("copper-Lantern-tuesday7", row!.passwordHash));
  t("the old one no longer works",
    !bcrypt.compareSync(rules.STARTING_STAFF_PASSWORD, row!.passwordHash));
  t("and the forced-change flag is cleared", row!.mustChangePassword === false);

  const replay = reset.resetPasswordWithToken(token!, "Quiet7Rivers-Marmalade", "Quiet7Rivers-Marmalade", "1.2.3.4");
  t("the link cannot be used a second time", !replay.ok, replay.ok ? "" : replay.error);
  t("so the password is still the first new one",
    bcrypt.compareSync("copper-Lantern-tuesday7",
      db.select().from(schema.users).where(eq(schema.users.email, OWNER)).get()!.passwordHash));
}

{
  /* Asking twice must leave only the newest link working. Otherwise an old
     email — forwarded, or sitting in a shared inbox — still opens the account
     after somebody has taken the trouble to ask for a fresh one. */
  await reset.requestPasswordReset(OWNER, { ip: "1.2.3.4", siteUrl: "https://example.test" });
  const first = latestLink();
  await reset.requestPasswordReset(OWNER, { ip: "1.2.3.4", siteUrl: "https://example.test" });
  const second = latestLink();
  t("asking again produces a different link", Boolean(first && second && first !== second));
  t("the earlier link stops working", !reset.checkResetToken(first!).ok);
  t("the newest link works", reset.checkResetToken(second!).ok);
}

{
  const before = db.select().from(schema.passwordResets).all().length;
  const unknown = await reset.requestPasswordReset("nobody@example.test",
    { ip: "1.2.3.4", siteUrl: "https://example.test" });
  t("an unknown address sends nothing", !unknown.sent);
  t("and creates no reset row",
    db.select().from(schema.passwordResets).all().length === before);
  t("but is written to the audit log, so probing is visible", (() => {
    const rows = db.select().from(schema.auditLog).all();
    return rows.some((r: { action: string }) => r.action === "password.reset.unknown");
  })());
}

{
  /* An expired link. Reaching in to age the row is fair here: the alternative
     is a test that takes half an hour. */
  await reset.requestPasswordReset(OWNER, { ip: "9.9.9.9", siteUrl: "https://example.test" });
  const token = latestLink();
  const raw = new DatabaseSync(dbFile);
  raw.exec("update password_resets set expires_at = strftime('%s','now') - 60 where used_at is null");
  raw.close();
  const check = reset.checkResetToken(token!);
  t("an expired link is refused", !check.ok, check.ok ? "" : check.error);
  t("and says so in a way that suggests what to do",
    !check.ok && /expired/i.test(check.error) && /new one/i.test(check.error));
}

{
  const deactivated = "gone@example.test";
  db.insert(schema.users).values({
    email: deactivated, passwordHash: bcrypt.hashSync("whatever-Long1", 4),
    name: "Left The Company", role: "staff", isActive: false,
  }).run();
  const result = await reset.requestPasswordReset(deactivated,
    { ip: "1.2.3.4", siteUrl: "https://example.test" });
  t("a deactivated account cannot ask for a link", !result.sent);
}

console.log("\n── Asking too often ──");
{
  limiter.resetAllLimits();
  const key = "test:thing";
  const limit = { max: 3, windowSeconds: 60, blockSeconds: 60 };
  const verdicts = [1, 2, 3, 4, 5].map(() => limiter.hit(key, limit).allowed);
  t("the first three go through", verdicts.slice(0, 3).every(Boolean));
  t("the fourth and fifth are refused", !verdicts[3] && !verdicts[4]);
  t("and asking without counting agrees", !limiter.isLimited(key).allowed);
  t("with a wait in seconds to report", limiter.isLimited(key).retryAfter > 0);
  limiter.clearLimit(key);
  t("clearing it lets the next one through", limiter.hit(key, limit).allowed);
}
{
  limiter.resetAllLimits();
  /* The reason this moved into the database: the old counters lived in a Map
     in the server process, so every deploy forgave every attacker. A row in
     the database is the same row after a restart — which is what this checks,
     by reading it with a second connection that shares no memory with the
     first. */
  /* Six attempts, but only four are counted: once the limit is crossed the
     limiter answers from the block without incrementing, so a flood does not
     inflate the number in the row. */
  for (let i = 0; i < 6; i++) limiter.hit("test:persist", { max: 3, windowSeconds: 60 });
  const raw = new DatabaseSync(dbFile);
  const row = raw.prepare("select count, blocked_until from rate_limits where key = ?").get("test:persist");
  raw.close();
  t("the counter is on disk, not in this process's memory",
    Boolean(row) && Number((row as { count: number }).count) === 4);
  t("and the block is recorded with it",
    Number((row as { blocked_until: number }).blocked_until) > Math.floor(Date.now() / 1000));
}
{
  limiter.resetAllLimits();
  const email = "target@example.test";
  for (let i = 0; i < guard.LOGIN_LIMITS.MAX_PER_EMAIL; i++) guard.noteFailure(email, "5.5.5.5");
  t(`${guard.LOGIN_LIMITS.MAX_PER_EMAIL} wrong passwords locks that account`,
    guard.lockedFor(email, "5.5.5.5") > 0, `${guard.lockedFor(email, "5.5.5.5")} minutes`);
  t("a different account from the same address is unaffected",
    guard.lockedFor("someone-else@example.test", "6.6.6.6") === 0);
  guard.noteSuccess(email, "5.5.5.5");
  t("a correct password clears it", guard.lockedFor(email, "5.5.5.5") === 0);
}
{
  /* The owner letting a colleague back in.
   *
   * The behaviour the staff screen depends on: an owner can see that one
   * account is locked, clear it for that account alone, and do so without
   * touching the password — otherwise the only way back in on a Friday
   * evening is to reset the password of the person who takes the bookings. */
  limiter.resetAllLimits();
  const locked = "priya@example.test";
  const other = "raj@example.test";
  for (let i = 0; i < guard.LOGIN_LIMITS.MAX_PER_EMAIL; i++) guard.noteFailure(locked, "7.7.7.7");
  for (let i = 0; i < guard.LOGIN_LIMITS.MAX_PER_EMAIL; i++) guard.noteFailure(other, "7.7.7.7");

  t("the staff screen can see who is locked out without knowing their address",
    guard.emailLockedFor(locked) > 0, `${guard.emailLockedFor(locked)} minutes`);
  t("and reports nothing for an account that is fine",
    guard.emailLockedFor("nobody@example.test") === 0);

  guard.clearEmailLock(locked);
  t("an owner can clear one account's lock", guard.emailLockedFor(locked) === 0);
  t("without freeing everyone else who was locked", guard.emailLockedFor(other) > 0);
  t("and the account can sign in again immediately",
    guard.lockedFor(locked, "7.7.7.7") === 0);
}

console.log("\n" + "─".repeat(60));
console.log(`${pass}/${pass + fail} checks passed`);
/* Step out before deleting it: Windows refuses to remove a directory that is
   some process's working directory. */
/* Let go of the database before deleting the folder it lives in: Windows
   refuses to remove a file that is still open, so on that machine every check
   passed and then the run ended with EBUSY. And if the delete fails anyway —
   an editor watching the folder, a virus scanner holding a handle — say so
   quietly rather than turning a green run red. The folder is gitignored and
   the next run clears it. */
closeDatabase();
process.chdir(projectRoot);
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  console.log(`  (could not remove ${path.basename(dir)} — it will be cleared on the next run)`);
}

process.exit(fail ? 1 : 0);
