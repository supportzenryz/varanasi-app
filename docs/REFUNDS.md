# Refunding a deposit

**Admin → Reservations.** Any booking whose deposit shows as *paid* has a
**Refund** control beneath its status buttons. Owners and managers; not staff.

Leave the amount box empty to give the whole deposit back. Type an amount to
keep part of it — a late cancellation where the restaurant retains some of the
deposit is a normal thing to do, and the amount is whatever you decide it is.

Both sides are emailed: the guest is told the amount and that it takes five to
ten working days to appear, and the restaurant's notification addresses get a
copy. It goes into the Activity log, and to the owner immediately, because it
is money leaving the account.

---

## Why this exists

There was no path for it. Cancelling a paid booking released the table and
emailed the guest to say it was cancelled, and left their money sitting with
Stripe. So either a manager opened the Stripe dashboard themselves, or the
restaurant quietly kept a deposit for a table it had cancelled. The second is
not a position to be in with a guest, and under the Consumer Rights Act it is
not a position to be in at all.

## What the code is careful about

**The money moves first, the record second.** Stripe is asked what it has
already refunded, the remainder is refunded there, and only once Stripe has
said yes is the booking marked refunded. A failure leaves the row untouched and
the reason on screen, which you can recover from. The other order would leave a
booking marked refunded against money still in the account — which nobody would
notice until the reconciliation.

**A retry cannot pay twice.** A refund request that times out on the way back
looks identical to one that never happened. Repeating it without an
idempotency key refunds the guest a second time, out of the restaurant's own
balance. Every refund carries a key scoped to the payment *and the amount*, so
a retry replays the original, while genuinely refunding the remainder of a
partial refund is a new request.

**It cannot exceed what was taken.** Stripe would refuse it anyway, but
checking here means the screen can say what is left instead of showing a raw
API error.

## Without Stripe keys

The site runs a built-in payment simulator when `STRIPE_SECRET_KEY` is not set,
so the whole booking journey can be demonstrated before any account exists.
Refunds work there too: the booking moves, both emails go out, and every
message says plainly that no money actually moved.
