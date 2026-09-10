import "server-only";
import crypto from "node:crypto";

/**
 * A very small Stripe client built on `fetch` — no `stripe` package.
 *
 * The project deliberately carries no dependency that needs a native build or a
 * postinstall script (npm's install-script policy blocked those on Sathish's
 * machine), and this integration only needs three calls: create a Checkout
 * Session, read one back, and verify a webhook signature. Stripe's REST API is
 * form-encoded, so all three are a few lines each.
 *
 * We never see or handle a card. Stripe Checkout hosts the payment page.
 */

const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * True when we're running the built-in simulator instead of real Stripe.
 *
 * Never in production by accident — only when somebody has typed out the
 * opt-in below — and that is the whole point of this function.
 *
 * It used to be `!stripeConfigured()` — so the single fact that decided
 * between "take a real payment" and "pretend" was whether one environment
 * variable happened to be set. Misname it in Railway, drop it while editing
 * the others, deploy a service that hasn't inherited it: every deposit and
 * every gift voucher becomes a free click, `/checkout-simulator` serves its
 * "Pay" button to the public, the confirmation page accepts any `sim_` session
 * id as proof of payment, and refunds report success without contacting
 * anybody. No error is logged, because from the code's point of view nothing
 * went wrong.
 *
 * A missing key in production is a configuration failure, and it should read
 * as one: `createDepositCheckout` throws, the guest is told we couldn't open
 * the payment page and to ring the restaurant, and the table is not confirmed.
 * A guest who cannot pay is a bad afternoon. A hundred guests who paid nothing
 * and hold real tables is a bad month.
 */
export function stripeSimulated(): boolean {
  if (stripeConfigured()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  /* One deliberate exception, and it is deliberately awkward to set.
   *
   * The end-to-end suite runs against a production build (`next start` sets
   * NODE_ENV=production), and one of the journeys it has to walk is a table
   * that is actually paid for. It cannot use real Stripe — there is no account
   * and no key — so without a way to say "yes, I mean the simulator, in a
   * production build", fifteen checks covering the paid-booking path and the
   * refund path simply stop running. Losing the tests that guard the money is
   * a poor way to protect the money.
   *
   * So the escape hatch exists, and asks to be typed out in full. What was
   * dangerous before was not the simulator; it was that a MISSING variable
   * silently selected it. Nobody sets this sentence by mistake, and the boot
   * log and the admin's own Payments tile both say it is on. */
  return process.env.PAYMENTS_SIMULATOR === "i-understand-no-money-will-be-taken";
}

/**
 * Production, and no payment provider at all. Nothing can be charged.
 *
 * Worth naming so the booking form can say something true to the guest rather
 * than failing at Stripe's front door, and so `npm run doctor` and the admin
 * can report it as the outage it is.
 */
export function paymentsUnavailable(): boolean {
  return !stripeConfigured() && !stripeSimulated();
}

function key(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("STRIPE_SECRET_KEY is not set");
  return k;
}

/** Stripe wants nested params as `a[b][c]=v`, so flatten before encoding. */
function formEncode(obj: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      parts.push(...formEncode(v as Record<string, unknown>, name));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(...formEncode(item as Record<string, unknown>, `${name}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts;
}

async function call<T>(
  path: string,
  body?: Record<string, unknown>,
  method = "POST",
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/x-www-form-urlencoded",
    // pinning avoids a future API change altering these shapes underneath us
    "Stripe-Version": "2024-06-20",
  };

  // Stripe replays the original response for a repeated key rather than acting
  // twice, which is what makes a create call safe to retry. Without it, a
  // request that times out on the way back — the caller sees a failure, Stripe
  // saw a success — leaves a second Checkout Session against the same booking,
  // and the id we store points at only one of them. Keys are scoped to the
  // booking reference or voucher code, both unique, and Stripe holds them for
  // 24 hours, comfortably longer than any table hold.
  if (idempotencyKey && method === "POST") headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? formEncode(body).join("&") : undefined,
    cache: "no-store",
  });

  const json = (await res.json()) as T & { error?: { message?: string; type?: string } };
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed: ${json?.error?.message ?? res.status}`);
  }
  return json;
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  status: "open" | "complete" | "expired";
  payment_intent: string | null;
  amount_total: number | null;
  /** Set to the booking reference or voucher code when the session is made. */
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
};

/** What a session is supposed to be paying for. */
export type SessionOwner =
  | { kind: "voucher"; id: number; reference: string; amountPence: number }
  | { kind: "booking"; id: number; reference: string; amountPence: number };

/**
 * Does this paid session actually pay for THIS order?
 *
 * THE HOLE THIS CLOSES, because it is worth being explicit about. Both Stripe
 * return pages read two things out of the query string — which order to fulfil,
 * and which session to check — and then fulfilled the first if the second said
 * "paid". They were never compared. The page's own comment argued that the
 * session id is proof of payment because Stripe handed it to the guest's
 * browser; that is true, and it is proof of *a* payment, not of *this* one.
 *
 * So: buy one £25 voucher, keep the `session_id` out of the address bar, then
 * start a £500 purchase, press back on Stripe's page to collect the new code
 * from the cancel URL, and open
 *
 *   /birmingham/gift-vouchers/confirmed?code=<new>&session_id=<the £25 one>
 *
 * The £500 voucher is issued, emailed and spendable at the till. Repeat for
 * free vouchers indefinitely. The booking equivalent confirms a table and marks
 * a deposit captured that was never paid — and then overwrites the row's
 * payment intent, so a later refund of the fraudulent booking is taken out of
 * the honest guest's payment.
 *
 * Everything needed to stop it was already being sent to Stripe at creation and
 * simply never read back: `metadata.voucherId`/`metadata.bookingId` and
 * `client_reference_id`. Three things have to agree — the row id, the
 * reference, and the amount — because each catches a different mistake:
 *
 *   id         a session for a different order
 *   reference  a stale session for a row id since reused
 *   amount     a cheap session fulfilling an expensive order
 *
 * The amount check also catches an unrelated defect: a Checkout Session opened
 * for one deposit but attached to a booking whose party size has since changed.
 */
export function sessionPaysFor(
  session: CheckoutSession,
  expect: SessionOwner,
): { ok: true } | { ok: false; reason: string } {
  const meta = session.metadata ?? {};
  const namedId = expect.kind === "voucher" ? meta.voucherId : meta.bookingId;

  if (!namedId) {
    return { ok: false, reason: `the session carries no ${expect.kind} id` };
  }
  if (namedId !== String(expect.id)) {
    return { ok: false, reason: `the session was paid for ${expect.kind} ${namedId}, not ${expect.id}` };
  }
  /* `client_reference_id` is only checked when Stripe returned one. It is
     always set on sessions this app creates, but refusing a payment because a
     field was absent would turn a Stripe API change into refused money, and
     the id check above is already decisive. */
  if (session.client_reference_id && session.client_reference_id !== expect.reference) {
    return { ok: false, reason: `the session references ${session.client_reference_id}, not ${expect.reference}` };
  }
  if (session.amount_total != null && session.amount_total !== expect.amountPence) {
    return { ok: false, reason: `the session paid ${session.amount_total}p, but this is ${expect.amountPence}p` };
  }
  return { ok: true };
}

/**
 * A hosted payment page for one booking deposit.
 * `submit_type: "book"` is Stripe's own recommendation for reservations — the
 * button reads "Book" rather than "Pay".
 */
export async function createDepositCheckout(opts: {
  amountPence: number;
  bookingId: number;
  reference: string;
  branchCity: string;
  guestEmail?: string | null;
  partySize: number;
  dateLabel: string;
  timeLabel: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
  depositNote: string;
}): Promise<CheckoutSession> {
  return call<CheckoutSession>("/checkout/sessions", {
    mode: "payment",
    submit_type: "book",
    locale: "en-GB",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: opts.guestEmail || undefined,
    client_reference_id: opts.reference,
    // Stripe requires 30 minutes minimum, so a shorter table hold is enforced
    // on our side and this only stops the link living for a full day.
    expires_at: Math.max(opts.expiresAt, Math.floor(Date.now() / 1000) + 1800),
    metadata: {
      bookingId: String(opts.bookingId),
      reference: opts.reference,
      branch: opts.branchCity,
    },
    payment_intent_data: {
      description: `Varanasi ${opts.branchCity} — table deposit ${opts.reference}`,
      metadata: { bookingId: String(opts.bookingId), reference: opts.reference },
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: opts.amountPence,
        product_data: {
          name: `Table deposit — Varanasi ${opts.branchCity}`,
          description:
            `${opts.partySize} ${opts.partySize === 1 ? "guest" : "guests"}, ` +
            `${opts.dateLabel} at ${opts.timeLabel}. ${opts.depositNote}`,
        },
      },
    }],
  }, "POST", `deposit:${opts.reference}`);
}

export async function retrieveSession(id: string): Promise<CheckoutSession> {
  return call<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}`, undefined, "GET");
}

/**
 * Verify a webhook came from Stripe.
 *
 * The `Stripe-Signature` header looks like `t=1699…,v1=abc…`. The signed
 * payload is `${timestamp}.${rawBody}`, HMAC-SHA256 with the endpoint secret.
 * Compared in constant time, and rejected if the timestamp is outside the
 * tolerance so a captured request can't be replayed later.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null, toleranceSeconds = 300):
  { ok: true; event: StripeEvent } | { ok: false; reason: string } {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "STRIPE_WEBHOOK_SECRET is not set" };
  if (!signatureHeader) return { ok: false, reason: "missing Stripe-Signature header" };

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    }),
  );
  const timestamp = parts["t"];
  const provided = parts["v1"];
  if (!timestamp || !provided) return { ok: false, reason: "malformed Stripe-Signature header" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return { ok: false, reason: "signature timestamp outside tolerance" };

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  try {
    return { ok: true, event: JSON.parse(rawBody) as StripeEvent };
  } catch {
    return { ok: false, reason: "body was not JSON" };
  }
}

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * A hosted payment page for a gift voucher. Same pattern as the deposit — we
 * never see a card — but priced as a product rather than a booking, so the
 * button reads "Pay" and the description says who it's for.
 */
export async function createVoucherCheckout(opts: {
  amountPence: number;
  voucherId: number;
  code: string;
  purchaserEmail?: string | null;
  recipientName: string;
  validAt: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  return call<CheckoutSession>("/checkout/sessions", {
    mode: "payment",
    locale: "en-GB",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: opts.purchaserEmail || undefined,
    client_reference_id: opts.code,
    metadata: { voucherId: String(opts.voucherId), code: opts.code, kind: "voucher" },
    payment_intent_data: {
      description: `Varanasi gift voucher ${opts.code}`,
      metadata: { voucherId: String(opts.voucherId), code: opts.code, kind: "voucher" },
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: opts.amountPence,
        product_data: {
          name: "Varanasi gift voucher",
          description: `For ${opts.recipientName}. Valid at ${opts.validAt}.`,
        },
      },
    }],
  }, "POST", `voucher:${opts.code}`);
}

/* ------------------------------------------------------------------ refunds */

export type Refund = {
  id: string;
  status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action";
  amount: number;
  currency: string;
  payment_intent: string;
  failure_reason?: string;
};

/**
 * Give a deposit back.
 *
 * There was no way to do this from the admin at all. Cancelling a booking that
 * had paid released the table and told the guest it was cancelled, and left
 * their money sitting with Stripe — so a manager either opened the Stripe
 * dashboard themselves, or the restaurant quietly kept a deposit for a table
 * it had cancelled. Neither is a position to be in with a guest, and under the
 * Consumer Rights Act the second one is not a position to be in at all.
 *
 * Idempotency-Key is doing real work here rather than being belt-and-braces.
 * A refund that times out on the way back looks to the caller exactly like one
 * that never happened; retrying without a key refunds the guest twice, and the
 * second one comes out of the restaurant's balance. The key is scoped to the
 * payment intent, so a retry returns the original refund instead of making a
 * new one, and Stripe holds it for 24 hours.
 *
 * A partial refund is allowed — a late cancellation where the restaurant keeps
 * part of the deposit is a normal thing for a restaurant to do — but the
 * amount is decided by the caller, never by the form.
 */
export async function refundDeposit(opts: {
  paymentIntent: string;
  amountPence?: number;            // omit to refund the whole thing
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  idempotencyKey?: string;
}): Promise<Refund> {
  const body: Record<string, unknown> = {
    payment_intent: opts.paymentIntent,
    reason: opts.reason ?? "requested_by_customer",
  };
  if (opts.amountPence != null) body.amount = opts.amountPence;

  return call<Refund>(
    "/refunds",
    body,
    "POST",
    opts.idempotencyKey ?? `refund:${opts.paymentIntent}`,
  );
}

/** What has already been given back on one payment, in pence. Asked before
 *  every refund, so that a second attempt cannot quietly exceed what was
 *  taken — Stripe would refuse it, but refusing it here means the admin can
 *  say what is left rather than showing a raw API error. */
export async function refundedSoFar(paymentIntent: string): Promise<number> {
  const res = await call<{ data: Refund[] }>(
    `/refunds?payment_intent=${encodeURIComponent(paymentIntent)}&limit=100`,
    undefined,
    "GET",
  );
  return (res.data ?? [])
    .filter((r) => r.status === "succeeded" || r.status === "pending")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
}
