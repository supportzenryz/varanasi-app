/* The weekly email, and the consent behind it.
 *
 * Four things have to be true here, and three of them are about restraint
 * rather than function:
 *
 *   the old customer list is never imported
 *   somebody who unsubscribed is never quietly re-added
 *   a draft cannot be sent twice
 *   nothing is ever sent without a person asking for it
 *
 * A feature that mails a restaurant's entire customer list is the one place in
 * this system where "it worked when I tried it" is not good enough, because
 * the failure cannot be undone and lands in several hundred inboxes at once.
 *
 *   npm run test:marketing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);
const projectRoot = fileURLToPath(root);
const dir = path.join(projectRoot, ".tmp-marketing-test");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(dir, "data"), { recursive: true });

/* The shipped modules, copied with the `@/` alias and the `server-only` guard
   rewritten and nothing else changed — the same arrangement the money and
   accounts suites use. Importing them where they sit fails: `server-only`
   throws by design outside Next's server graph, which is the whole point of
   it. */
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
/* booking.json is read relative to the working directory, which is `dir`. */
fs.cpSync(new URL("data/", root), path.join(dir, "data"), { recursive: true, filter: (s) => !/outbox|backups|\.db/.test(s) });

const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = dbFile;
process.env.SITE_URL = "https://varanasi.test";
/* No provider key and no webhook, so every message goes to data/outbox as a
   file. That is what lets this suite read what would have been sent. */
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_WEBHOOK_URL;

/* Build the schema by replaying the real migrations, so this suite fails if a
   migration is wrong rather than testing a hand-written copy of the tables. */
{
  const raw = new DatabaseSync(dbFile);
  const journal = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(projectRoot, "drizzle", `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  raw.exec(`INSERT INTO branches (id, slug, name, city, address_line, postcode, phone, is_published, sort)
            VALUES (1,'birmingham','Varanasi Birmingham','Birmingham','184 Broad Street','B15 1DA','0121 000 0000',1,0),
                   (2,'leicester','Varanasi Leicester','Leicester','89-91 High Street','LE1 4JB','0116 000 0000',1,1)`);
  raw.exec(`INSERT INTO users (id, email, password_hash, name, role, is_active)
            VALUES (1,'owner@varanasi.test','x','The Owner','owner',1)`);
  raw.close();
}

process.chdir(dir);
const marketing = await import(pathToFileURL(path.join(dir, "marketing.ts")).href);
const campaign = await import(pathToFileURL(path.join(dir, "campaign.ts")).href);
const { closeDatabase } = await import(pathToFileURL(path.join(dir, "db.ts")).href);

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (ok) pass++; else fail++;
};

console.log("\n── Consent ──");
{
  const a = marketing.recordConsent({
    email: "Emily@Example.test", name: "Emily Warner", branchId: 1,
    source: "booking", consentText: "I'd like to hear about events and new menus.",
  });
  t("someone who ticks the box joins the list", a.added === true);

  const list = marketing.audience();
  t("stored in lower case, so one person cannot join twice",
    list.length === 1 && list[0].email === "emily@example.test");
  t("the wording they agreed to is kept verbatim",
    list[0].consentText === "I'd like to hear about events and new menus.");
  t("with the moment they agreed", Number(list[0].consentedAt) > 0);

  const again = marketing.recordConsent({
    email: "emily@example.test", name: "Emily Warner-Hughes", source: "enquiry",
  });
  t("booking a second time does not add them twice", again.added === false);
  t("but their name is brought up to date",
    marketing.audience()[0].name === "Emily Warner-Hughes");

  t("an address that isn't one is refused",
    marketing.recordConsent({ email: "not-an-address", source: "booking" }).added === false);
}

console.log("\n── Unsubscribing ──");
{
  const before = marketing.audience()[0];
  const out = marketing.unsubscribeByToken(before.unsubscribeToken);
  t("the link in the email takes them off", out.ok === true && out.email === "emily@example.test");
  t("and they are no longer in the audience", marketing.audience().length === 0);

  t("pressing the link a second time is still a success, not an error",
    marketing.unsubscribeByToken(before.unsubscribeToken).ok === true);

  /* The one that matters. Somebody who opted out in March and books a table in
     June has not changed their mind by booking a table. */
  const re = marketing.recordConsent({
    email: "emily@example.test", name: "Emily", source: "booking",
  });
  t("booking again does NOT put an unsubscribed person back on the list",
    re.added === false && re.reason === "this address has unsubscribed");
  t("and the audience is still empty", marketing.audience().length === 0);

  t("an unknown token is refused rather than throwing",
    marketing.unsubscribeByToken("nonsense-token").ok === false);

  t("the row is kept, not deleted — the unsubscribe has to outlive them",
    marketing.listCounts().unsubscribed === 1);
}

console.log("\n── The draft ──");
{
  const first = campaign.prepareWeeklyDraft();
  t("a draft is prepared for this week", Boolean(first) && first.status === "draft");
  t("it is prepared by the scheduler, not a person", first.preparedBy === "scheduler");
  t("it carries this week's Monday", first.weekOf === marketing.weekOf());

  const second = campaign.prepareWeeklyDraft();
  t("running the scheduler again the same week prepares nothing further", second === null);
  t("so an hourly scheduler cannot produce seven drafts by Sunday",
    marketing.recentCampaigns().length === 1);

  const draft = marketing.pendingDraft()!;
  t("the body is real text, not a template with gaps",
    draft.body.length > 120 && !/\[INSERT|TODO|LOREM/i.test(draft.body));
  t("it addresses the reader by name", draft.body.includes("{{name}}"));
  t("and points at the real booking page",
    draft.body.includes("https://varanasi.test/birmingham/book-online"));
}

console.log("\n── Sending ──");
{
  // Two people on the list, one of whom has unsubscribed and must not be mailed.
  marketing.recordConsent({ email: "raj@example.test", name: "Raj Patel", branchId: 1, source: "booking" });
  marketing.recordConsent({ email: "sam@example.test", name: "Sam Okafor", branchId: 2, source: "enquiry" });

  const draft = marketing.pendingDraft()!;
  t("the audience is the two who are still subscribed", marketing.audience().length === 2);

  const result = await campaign.sendCampaign(draft.id, 1);
  t("the send reports what it did", result.ok === true, `${result.sent} sent, ${result.failed} refused`);
  t("it reached both of them", result.sent === 2);

  const sent = marketing.recentCampaigns().find((c: { id: number }) => c.id === draft.id)!;
  t("the campaign is marked sent", sent.status === "sent");
  t("with who pressed the button", sent.sentByUserId === 1);
  t("and how many it reached", sent.recipientCount === 2);

  /* The expensive mistake this prevents: a double-click, a browser resend, or
     two owners on the same screen mailing the whole list twice. */
  const twice = await campaign.sendCampaign(draft.id, 1);
  t("sending the same campaign a second time is refused",
    twice.ok === false && /already been sent/i.test(twice.error ?? ""));

  t("nothing further has gone out", marketing.audience()
    .filter((c: { lastSentAt: number | null }) => c.lastSentAt).length === 2);
}

console.log("\n── What actually went in the envelope ──");
{
  const outbox = path.join(dir, "data", "outbox");
  const names = fs.readdirSync(outbox);
  const files = names.map((f) => fs.readFileSync(path.join(outbox, f), "utf8"));

  /* Both messages, not "the two newest". They are written inside the same
     millisecond, so sorting by timestamp cannot separate them — and an
     earlier version of this check did exactly that, which is how the outbox
     writer's same-millisecond collision was found: one of the two files was
     missing entirely because the second had overwritten the first. */
  t("every message is its own file, even sent in the same millisecond",
    names.length === 2, `${names.length} file(s)`);

  const raj = files.find((f) => f.includes("raj@example.test"));
  t("the message reached the outbox", Boolean(raj));
  t("addressed to them by first name, not {{name}}",
    Boolean(raj && raj.includes("Dear Raj") && !raj.includes("{{name}}")));
  t("carries a working unsubscribe link",
    Boolean(raj && /https:\/\/varanasi\.test\/unsubscribe\/[\w-]{20,}/.test(raj)));
  const tokens = new Set(files.map((f) => f.match(/unsubscribe\/([\w-]+)/)?.[1]).filter(Boolean));
  t("and each person's link is their own", tokens.size === files.length,
    `${tokens.size} distinct link(s) across ${files.length} message(s)`);
}

console.log("\n── The old customer list ──");
{
  /* Not a behaviour test — a promise test. The 4,826-row export from the
     previous supplier must have no route into this system at all, and the way
     to keep that true a year from now is for the suite to fail the moment
     somebody adds one. */
  const sources = ["src/lib/marketing.ts", "src/lib/campaign.ts"]
    .map((f) => fs.readFileSync(path.join(projectRoot, f), "utf8")).join("\n");
  t("no import path from the previous supplier's export exists",
    !/zpos|import.*csv|readFileSync.*\.csv/i.test(sources));
  t("the only way onto the list is recordConsent",
    (sources.match(/insert\(marketingContacts\)/g) ?? []).length === 1);
}

console.log("\n" + "─".repeat(60));
console.log(`${pass}/${pass + fail} checks passed`);
closeDatabase();
process.chdir(projectRoot);
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  console.log(`  (could not remove ${path.basename(dir)} — it will be cleared on the next run)`);
}
process.exit(fail ? 1 : 0);
