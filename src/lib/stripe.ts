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

/** True when we're running the built-in simulator instead of real Stripe. */
export function stripeSimulated(): boolean {
  return !stripeConfigured();
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

async function call<T>(path: string, body?: Record<string, unknown>, method = "POST"): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // pinning avoids a future API change altering these shapes underneath us
      "Stripe-Version": "2024-06-20",
    },
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
  metadata?: Record<string, string>;
};

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
  });
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
  });
}
