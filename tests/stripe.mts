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
const { verifyWebhook, createDepositCheckout, createVoucherCheckout, refundDeposit, refundedSoFar } =
  await import(tmp);

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (ok) pass++; else fail++;
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

/* The stub records what would have gone to Stripe. Typed, so that a change to
   the call shape shows up here as a compile error rather than as a test that
   quietly asserts against `undefined`. */
type SeenCall = {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: string;
};
const seen: SeenCall[] = [];

const stub = (respond: (url: string) => unknown): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ""),
    });
    return { ok: true, json: async () => respond(url) } as Response;
  }) as typeof fetch;

globalThis.fetch = stub(() => ({
  id: "cs_test", url: "https://stripe.test/x", payment_status: "unpaid", status: "open",
}));

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

console.log("\n── Refunds ──");

/* A refund is the one call where a retry costs real money: a request that
   times out on the way back looks identical to one that never happened, and
   repeating it without a key pays the guest twice out of the restaurant's
   balance. */
seen.length = 0;
globalThis.fetch = stub((url) =>
  url.includes("/refunds?")
    ? { data: [
        { id: "re_1", status: "succeeded", amount: 1000, currency: "gbp", payment_intent: "pi_1" },
        { id: "re_2", status: "failed",    amount: 500,  currency: "gbp", payment_intent: "pi_1" },
        { id: "re_3", status: "pending",   amount: 250,  currency: "gbp", payment_intent: "pi_1" },
      ] }
    : { id: "re_new", status: "succeeded", amount: 2000, currency: "gbp", payment_intent: "pi_1" });

await refundDeposit({ paymentIntent: "pi_1", amountPence: 2000 });
t("a refund carries an Idempotency-Key, so a retry cannot pay the guest twice",
  Boolean(seen[0].headers["Idempotency-Key"]), String(seen[0].headers["Idempotency-Key"]));
t("  · keyed on the payment it is refunding",
  String(seen[0].headers["Idempotency-Key"]).includes("pi_1"), seen[0].headers["Idempotency-Key"]);
t("the amount is sent in pence", /(^|&)amount=2000(&|$)/.test(seen[0].body), seen[0].body);
t("the payment intent is sent", seen[0].body.includes("payment_intent=pi_1"));
t("a reason is sent, defaulting to the customer's request",
  seen[0].body.includes("reason=requested_by_customer"), seen[0].body);
t("the secret key stays in the header", !seen[0].body.includes("sk_test"));

seen.length = 0;
await refundDeposit({ paymentIntent: "pi_1" });
t("omitting the amount refunds the whole payment — no amount is sent",
  !/(^|&)amount=/.test(seen[0].body), seen[0].body);

seen.length = 0;
await refundDeposit({ paymentIntent: "pi_1", amountPence: 500, idempotencyKey: "refund:pi_1:500" });
t("a partial refund of the remainder is a different key, not a replay of the first",
  seen[0].headers["Idempotency-Key"] === "refund:pi_1:500", seen[0].headers["Idempotency-Key"]);

/* Succeeded and pending both count against what is left. Treating a pending
   refund as not-yet-refunded is how a deposit gets given back twice. */
const already = await refundedSoFar("pi_1");
t("what has already gone back counts succeeded and pending, and ignores failed",
  already === 1250, `£${(already / 100).toFixed(2)} (expected £12.50)`);

console.log(`\n${"─".repeat(60)}\n${pass}/${pass + fail} checks passed\n`);
process.exit(fail ? 1 : 0);
