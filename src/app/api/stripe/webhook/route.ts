import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/stripe";
import {
  bookingById, bookingBySessionId, confirmPaidBooking, markPaymentFailed, notifyPaymentFailed,
} from "@/lib/booking";
import {
  voucherById, voucherBySession, activatePaidVoucher, markPurchaseFailed,
} from "@/lib/voucher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe's webhook — the authority on whether a deposit was paid.
 *
 * Stripe is explicit that you can't rely on the return page alone: a guest can
 * pay and then lose their connection before it loads. This endpoint is what
 * guarantees the booking gets confirmed and the emails get sent either way.
 *
 * The raw body is read as text, never parsed first, because the signature is
 * computed over the exact bytes Stripe sent.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const verified = verifyWebhook(raw, req.headers.get("stripe-signature"));

  if (!verified.ok) {
    // 400 tells Stripe to retry; it also means an unsigned request gets nowhere.
    console.error(`[stripe:webhook] rejected — ${verified.reason}`);
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  const { event } = verified;
  const object = event.data.object as Record<string, unknown>;
  const sessionId = typeof object.id === "string" ? object.id : null;
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const bookingId = Number(metadata.bookingId);

  /* ---- gift vouchers ---- */
  if (metadata.kind === "voucher" || metadata.voucherId) {
    const voucher =
      (sessionId ? voucherBySession(sessionId) : undefined) ??
      (Number.isInteger(Number(metadata.voucherId)) ? voucherById(Number(metadata.voucherId)) : undefined);

    if (!voucher) {
      console.warn(`[stripe:webhook] ${event.type} for an unknown voucher (session ${sessionId})`);
      return NextResponse.json({ received: true, matched: false });
    }

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const status = object.payment_status;
      if (status === "paid" || status === "no_payment_required") {
        const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : null;
        const result = await activatePaidVoucher({ voucherId: voucher.id, paymentIntent, sessionId });
        console.log(`[stripe:webhook] voucher ${voucher.code} activated${result.alreadyDone ? " (already done)" : ""}`);
      }
    } else if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
      markPurchaseFailed(voucher.id);
      console.log(`[stripe:webhook] voucher ${voucher.code} cancelled — ${event.type}`);
    }
    return NextResponse.json({ received: true });
  }

  // Prefer the id we stored when creating the session; fall back to metadata.
  const booking =
    (sessionId ? bookingBySessionId(sessionId) : undefined) ??
    (Number.isInteger(bookingId) ? bookingById(bookingId) : undefined);

  if (!booking) {
    // Acknowledge anyway — retrying won't conjure a booking, and a 4xx here
    // would have Stripe hammering the endpoint over an event we can't use.
    console.warn(`[stripe:webhook] ${event.type} for an unknown booking (session ${sessionId})`);
    return NextResponse.json({ received: true, matched: false });
  }

  switch (event.type) {
    // Card payments land here already paid; delayed methods arrive "unpaid"
    // and finish later on async_payment_succeeded, hence the status check.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const status = object.payment_status;
      if (status === "paid" || status === "no_payment_required") {
        const paymentIntent = typeof object.payment_intent === "string" ? object.payment_intent : null;
        const result = await confirmPaidBooking({ bookingId: booking.id, paymentIntent, sessionId });
        console.log(`[stripe:webhook] ${booking.reference} confirmed${result.alreadyDone ? " (already done)" : ""}`);
      } else {
        console.log(`[stripe:webhook] ${booking.reference} completed but payment_status=${String(status)} — waiting`);
      }
      break;
    }

    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      markPaymentFailed(booking.id);
      await notifyPaymentFailed(booking);
      console.log(`[stripe:webhook] ${booking.reference} released — ${event.type}`);
      break;
    }

    default:
      // Everything else is fine to ignore, but acknowledge it so Stripe stops.
      break;
  }

  return NextResponse.json({ received: true });
}
