/* Stripe unit checks: webhook signature verification and request idempotency.
 *
 * These are the two places where a quiet regression is expensive. A broken
 * signature check means anyone who finds the webhook URL can confirm their own
 * booking without paying; a missing idempotency key means a retried request
 * silently opens a second Checkout Session against one booking. Neither shows
 * up in the browser suite, because neither is reachable from a page.
 *
 * No Stripe account and no real key: fetch is stubbed, and the signatures are
 * generated here with a throwaway secret.
 *
 *   npm run test:stripe
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STRIPE_SECRET_KEY = "sk_test_dummy_never_sent_anywhere";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy_local";

/* `server-only` throws when imported outside Next's server graph, so load a
   copy with that single line removed. Everything else is the shipped file. */
const src = fs.readFileSync(new URL("../src/lib/stripe.ts", import.meta.url), "utf8");
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stripe-test-")), "stripe.ts");
fs.writeFileSync(tmp, src.replace(/^import "server-only";\s*$/m, ""));
const { verifyWebhook, createDepositCheckout, createVoucherCheckout } = await import(tmp);

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

console.log("\n── Webhook signature ──");
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
const sign = (ts: number, b: string, secret = "whsec_dummy_local") =>
  `t=${ts},v1=${crypto.createHmac("sha256", secret).update(`${ts}.${b}`, "utf8").digest("hex")}`;
const now = Math.floor(Date.now() / 1000);

t("a correctly signed event is accepted", verifyWebhook(body, sign(now, body)).ok);
t("a tampered body is rejected", !verifyWebhook(body.replace("cs_1", "cs_HACKED"), sign(now, body)).ok);
t("a signature from another secret is rejected", !verifyWebhook(body, sign(now, body, "whsec_attacker")).ok);
t("an old signature is rejected (replay window)", !verifyWebhook(body, sign(now - 4000, body)).ok);
t("an unsigned request is rejected", !verifyWebhook(body, null).ok);
t("a malformed header is rejected", !verifyWebhook(body, "garbage").ok);
t("a signature for a different body is rejected",
  !verifyWebhook(body, sign(now, JSON.stringify({ id: "evt_other" }))).ok);

console.log("\n── Idempotency and headers ──");
const seen: any[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  seen.push({ url: String(url), headers: init.headers, body: String(init.body ?? "") });
  return { ok: true, json: async () => ({ id: "cs_test", url: "https://stripe.test/x", payment_status: "unpaid", status: "open" }) };
}) as any;

const deposit = {
  amountPence: 2000, bookingId: 7, reference: "VB-ABC123", branchCity: "Birmingham",
  guestEmail: "guest@example.com", partySize: 2, dateLabel: "Fri 5 Sep", timeLabel: "19:00",
  successUrl: "https://site/ok", cancelUrl: "https://site/no",
  expiresAt: now + 3600, depositNote: "comes off your bill",
};
await createDepositCheckout(deposit);
await createDepositCheckout(deposit);          // the same booking, retried
const k = seen.map((s) => s.headers["Idempotency-Key"]);

t("a create call carries an Idempotency-Key", Boolean(k[0]), String(k[0]));
t("retrying one booking reuses its key, so Stripe replays rather than duplicating", k[0] === k[1]);
t("the key is scoped to the booking reference", String(k[0]).includes("VB-ABC123"));
t("the pinned API version is sent", seen[0].headers["Stripe-Version"] === "2024-06-20",
  seen[0].headers["Stripe-Version"]);
t("the secret key is only ever an Authorization header, never in the body",
  !seen[0].body.includes("sk_test") && String(seen[0].headers.Authorization).startsWith("Bearer sk_"));

seen.length = 0;
await createVoucherCheckout({
  amountPence: 5000, voucherId: 3, code: "VG-XYZ789", purchaserEmail: "buyer@example.com",
  recipientName: "Asha", validAt: "both restaurants",
  successUrl: "https://site/ok", cancelUrl: "https://site/no",
});
t("a voucher purchase is keyed on its voucher code",
  String(seen[0].headers["Idempotency-Key"]).includes("VG-XYZ789"),
  seen[0].headers["Idempotency-Key"]);

console.log(`\n${"─".repeat(60)}\n${pass}/${pass + fail} checks passed\n`);
process.exit(fail ? 1 : 0);
