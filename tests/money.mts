/* The money paths, against a real database.
 *
 * Everything in here is a way the restaurant could lose money or give
 * something away, tested against a throwaway SQLite file with the real
 * migrations applied and the shipped code — not a mock of it.
 *
 * Each case below exists because the failure was reachable:
 *
 *   - a voucher could be redeemed twice by posting the form without one
 *     hidden field, so £100 could be spent as £200;
 *   - a purchase that had been marked abandoned stayed worthless after the
 *     card was charged, so the guest paid and got nothing;
 *   - one missing environment variable turned every deposit into a free
 *     click, with the "payment page" served by this repo.
 *
 *   npm run test:money
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = new URL(".", import.meta.url);
const root = new URL("../", here);

/* Load the shipped modules, with two mechanical rewrites and nothing else:
   the `@/` alias (tsx has no idea about Next's tsconfig paths) and the
   `server-only` import (which throws outside Next's server graph). The code
   under test is otherwise byte-for-byte what runs in production.

   The copies live inside the project rather than in the system temp folder,
   because they import drizzle-orm and Node resolves that by walking up from
   the importing file — from /tmp there is no node_modules to find. */
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
const dir = path.join(projectRoot, ".tmp-money-test");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

function load(from: string, as: string) {
  const src = fs.readFileSync(new URL(from, root), "utf8");
  fs.writeFileSync(path.join(dir, as), src
    .replace(/^import "server-only";\s*$/m, "")
    .replace(/@\/db\/schema/g, "./schema")
    .replace(/from "@\/db"/g, 'from "./db"')
    .replace(/@\/lib\//g, "./")
    // booking-config.ts reads the seed defaults from ../../data relative to
    // src/lib; the copies sit one level shallower.
    .replace(/\.\.\/\.\.\/data\//g, "../data/"));
}

load("src/db/schema.ts", "schema.ts");
load("src/db/sqlite.ts", "sqlite.ts");
load("src/db/index.ts", "db.ts");
for (const f of fs.readdirSync(new URL("src/lib/", root))) load(`src/lib/${f}`, f);

/* The database the code under test will open, and the folder it will write
   outbox files into. Both have to be settled before the first import, because
   `src/db/index.ts` resolves DATABASE_URL and `src/lib/email.ts` resolves the
   outbox path at module load. */
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = dbFile;
delete process.env.RESEND_API_KEY;      // so email goes to the outbox, not the internet
delete process.env.MAIL_WEBHOOK_URL;
delete process.env.TWILIO_ACCOUNT_SID;  // so WhatsApp is a no-op
process.chdir(dir);

/* Schema first: the real migrations, in the order the journal lists them —
   the same thing scripts/migrate.mjs does. */
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
  raw.exec(`insert into branches (slug, name, city, address_line, postcode, phone, email, sort)
            values ('birmingham','Varanasi Birmingham','Birmingham','1 Test Street','B1 1AA','0121 000 0000','b@example.com',1),
                   ('leicester','Varanasi Leicester','Leicester','2 Test Street','LE1 1AA','0116 000 0000','l@example.com',2)`);
  raw.exec(`insert into users (email, password_hash, name, role, branch_id, is_active, must_change_password)
            values ('till@example.com','x','Till','staff',1,1,0)`);
  raw.close();
}

const voucher = await import(pathToFileURL(path.join(dir, "voucher.ts")).href);
const stripe = await import(pathToFileURL(path.join(dir, "stripe.ts")).href);
const { db, closeDatabase } = await import(pathToFileURL(path.join(dir, "db.ts")).href);
const schema = await import(pathToFileURL(path.join(dir, "schema.ts")).href);
const { eq } = await import("drizzle-orm");

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (ok) pass++; else fail++;
};

const TILL = 1;

/** A live voucher, straight into the table — the purchase flow is exercised
 *  separately; these cases are about what happens to money afterwards. */
function makeVoucher(opts: { pence: number; branchId?: number | null; expiresAt?: number | null }) {
  const now = Math.floor(Date.now() / 1000);
  return db.insert(schema.vouchers).values({
    code: `VG-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    valuePence: opts.pence,
    balancePence: opts.pence,
    status: "active",
    purchaserName: "Buyer",
    purchaserEmail: "buyer@example.com",
    recipientName: "Recipient",
    recipientEmail: "recipient@example.com",
    branchId: opts.branchId ?? null,
    origin: "purchase",
    issuedAt: now,
    expiresAt: opts.expiresAt === undefined ? now + 86400 * 365 : opts.expiresAt,
  }).returning().get();
}

const balanceOf = (code: string) =>
  db.select().from(schema.vouchers).where(eq(schema.vouchers.code, code)).get()?.balancePence;
const ledgerCount = (id: number) =>
  db.select().from(schema.voucherRedemptions).where(eq(schema.voucherRedemptions.voucherId, id)).all().length;

console.log("\n── Redeeming a voucher ──");
{
  const v = makeVoucher({ pence: 10_000 });
  const r = voucher.redeem({
    code: v.code, amountPence: 6_400, branchId: null, userId: TILL,
    expectedBalancePence: 10_000,
  });
  t("a partial redemption leaves the remainder", r.ok && balanceOf(v.code) === 3_600,
    `balance ${balanceOf(v.code)}`);
  t("and writes one ledger row", ledgerCount(v.id) === 1);
}
{
  const v = makeVoucher({ pence: 5_000 });
  const r = voucher.redeem({
    code: v.code, amountPence: 5_000, branchId: null, userId: TILL,
    expectedBalancePence: 5_000,
  });
  t("spending the last of it marks the voucher redeemed",
    r.ok && db.select().from(schema.vouchers).where(eq(schema.vouchers.id, v.id)).get()?.status === "redeemed");
}

console.log("\n── The double-redemption guard ──");
{
  /* The one that mattered. The guard used to be an optional field, so a
     request that simply omitted it got the old unguarded behaviour. */
  const v = makeVoucher({ pence: 10_000 });
  const noGuard = voucher.redeem({
    code: v.code, amountPence: 10_000, branchId: null, userId: TILL,
    expectedBalancePence: Number(undefined),   // what a missing form field gives you
  });
  t("a request with no expected balance is refused", !noGuard.ok, noGuard.ok ? "" : noGuard.error);
  t("and nothing was taken off", balanceOf(v.code) === 10_000);
  t("and no ledger row was written", ledgerCount(v.id) === 0);
}
{
  const v = makeVoucher({ pence: 10_000 });
  const first = voucher.redeem({
    code: v.code, amountPence: 4_000, branchId: null, userId: TILL, expectedBalancePence: 10_000,
  });
  // The same post again: same amount, same stale balance — a double-tap, a
  // browser "resend", or the back button.
  const replay = voucher.redeem({
    code: v.code, amountPence: 4_000, branchId: null, userId: TILL, expectedBalancePence: 10_000,
  });
  t("the first redemption lands", first.ok);
  t("the replayed one is refused", !replay.ok);
  t("so £40 was taken once, not twice", balanceOf(v.code) === 6_000, `balance ${balanceOf(v.code)}`);
  t("and the ledger shows one movement", ledgerCount(v.id) === 1);
}
{
  const v = makeVoucher({ pence: 2_000 });
  const r = voucher.redeem({
    code: v.code, amountPence: 5_000, branchId: null, userId: TILL, expectedBalancePence: 2_000,
  });
  t("more than the voucher holds is refused", !r.ok);
  t("the balance cannot go negative", balanceOf(v.code) === 2_000);
}
{
  const v = makeVoucher({ pence: 2_000 });
  for (const amount of [0, -500, 12.5]) {
    const r = voucher.redeem({
      code: v.code, amountPence: amount, branchId: null, userId: TILL, expectedBalancePence: 2_000,
    });
    t(`${amount} is not a redeemable amount`, !r.ok);
  }
  t("none of those touched the balance", balanceOf(v.code) === 2_000);
}

console.log("\n── Where a voucher is valid ──");
{
  const v = makeVoucher({ pence: 5_000, branchId: 1 });   // Birmingham only
  const wrong = voucher.redeem({
    code: v.code, amountPence: 1_000, branchId: 2, userId: TILL, expectedBalancePence: 5_000,
  });
  t("a Birmingham voucher is refused at Leicester", !wrong.ok, wrong.ok ? "" : wrong.error);
  const right = voucher.redeem({
    code: v.code, amountPence: 1_000, branchId: 1, userId: TILL, expectedBalancePence: 5_000,
  });
  t("and accepted at Birmingham", right.ok);
}
{
  const v = makeVoucher({ pence: 5_000, expiresAt: Math.floor(Date.now() / 1000) - 60 });
  const r = voucher.redeem({
    code: v.code, amountPence: 1_000, branchId: null, userId: TILL, expectedBalancePence: 5_000,
  });
  t("an expired voucher is refused", !r.ok);
}
{
  const r = voucher.redeem({
    code: "VG-DOES-NOT-EXIST", amountPence: 1_000, branchId: null, userId: TILL,
    expectedBalancePence: 1_000,
  });
  t("an unknown code is refused", !r.ok);
}

console.log("\n── Paid for, but marked abandoned ──");
{
  /* Buyer opens checkout, touches the cancel URL (back button, link preview,
     mail scanner), then goes back and pays. Stripe charges the card. Before
     this fix the voucher stayed at zero and nobody was told. */
  const started = voucher.startPurchase({
    branchSlug: null, valuePence: 7_500,
    purchaserName: "Anita Rao", purchaserEmail: "anita@example.com",
    recipientName: "Dev Rao", recipientEmail: "dev@example.com",
  });
  t("a purchase starts as pending with no balance",
    started.ok && started.voucher.status === "pending" && started.voucher.balancePence === 0);
  const id = started.ok ? started.voucher.id : 0;

  voucher.markPurchaseFailed(id);
  t("marking it abandoned cancels it",
    db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id)).get()?.status === "cancelled");

  const result = await voucher.activatePaidVoucher({ voucherId: id, paymentIntent: "pi_test_1" });
  const after = db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id)).get();
  t("a payment that arrives afterwards still issues it", result.activated && !result.alreadyDone);
  t("with the full balance on it", after?.status === "active" && after?.balancePence === 7_500,
    `${after?.status} / ${after?.balancePence}`);

  const again = await voucher.activatePaidVoucher({ voucherId: id, paymentIntent: "pi_test_1" });
  t("and activating twice does nothing the second time", again.alreadyDone);
  t("the balance is still £75", balanceOf(after!.code) === 7_500);
}
{
  /* The opposite case, which must NOT be recovered: an owner cancelling a
     voucher that was properly issued. */
  const v = makeVoucher({ pence: 5_000 });
  db.update(schema.vouchers).set({ status: "cancelled", balancePence: 0 })
    .where(eq(schema.vouchers.id, v.id)).run();
  const result = await voucher.activatePaidVoucher({ voucherId: v.id });
  t("a voucher cancelled after it was issued is not resurrected",
    result.alreadyDone && balanceOf(v.code) === 0);
}

console.log("\n── The payment simulator ──");
{
  const was = process.env.NODE_ENV;
  // A plain assignment through a widened view: process.env refuses
  // defineProperty, and TypeScript types NODE_ENV as readonly.
  const env = process.env as Record<string, string | undefined>;
  const set = (v: string | undefined) => { env.NODE_ENV = v; };

  delete process.env.STRIPE_SECRET_KEY;
  set("development");
  t("no key in development: the simulator stands in", stripe.stripeSimulated());
  t("and payments are not reported as unavailable", !stripe.paymentsUnavailable());

  set("production");
  t("no key in production: the simulator is NOT used", !stripe.stripeSimulated());
  t("payments are reported as unavailable instead", stripe.paymentsUnavailable());

  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_never_sent_anywhere";
  t("with a key in production, neither is true",
    !stripe.stripeSimulated() && !stripe.paymentsUnavailable());
  t("and Stripe reports itself configured", stripe.stripeConfigured());
  set(was);
}

console.log("\n── Voucher codes ──");
{
  const codes = new Set<string>();
  for (let i = 0; i < 500; i++) codes.add(makeVoucher({ pence: 100 }).code.slice(0, 3));
  t("every code carries the VG- prefix", [...codes].every((c) => c === "VG-"));
}

console.log("\n" + "─".repeat(60));
console.log(`${pass}/${pass + fail} checks passed`);
/* Step out before deleting it. Windows refuses to remove a directory that is
   some process's working directory, and this suite chdir'd into it so the
   outbox files would land there. */
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
