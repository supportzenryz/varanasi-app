# Reservations — build notes (3 September 2026)

Supersedes the "Reservations deliberately not started" line and item 1 of
"Next, in order" in `varanasi-build-log.md`. The customer-facing booking flow
with mandatory deposit payment is now built, tested and delivered.

Journey-by-journey documentation for the whole site is in
`varanasi-site-flows.md`. This file is the engineering record.

## The instruction

A modern booking system, occasion as a dropdown, payment **mandatory** before
confirmation, details into the admin, email alerts to `sathish@zenryz.com` for
now, and the complete flow for every part of the site.

## Researched first, not recalled

WebSearch is blocked by the egress proxy in this session, but **WebFetch works** —
so Stripe's own docs were read directly rather than remembered:

- `submit_type: "book"` is Stripe's own recommendation for reservations (the
  button reads "Book", not "Pay")
- `expires_at` has a 30-minute floor, so the 20-minute table hold is enforced
  on our side and the Stripe link merely outlives it
- The documented fulfilment pattern: **the webhook is the authority**, the
  return page fulfils too (webhooks lag, and the guest is standing there), both
  must be idempotent, and you check `payment_status` rather than trusting the
  event name — because delayed payment methods complete "unpaid"

The market pattern (OpenTable / ResDiary / SevenRooms / Tock / Resy) came from
knowledge, and it is stable: search first then form, slots as buttons not a
dropdown, prepayment as the booking, hold-then-release.

## Built against the client's real rules

Pulled off their own captured site rather than invented — the capture's
`extracted/forms.json` and the booking page markup on Sathish's machine:

- Sittings 5:00pm–10:00pm, every 30 minutes (identical on both branches)
- £10 per person deposit, "deducted off the bill", non-refundable, 24 hours'
  notice to move
- More than 12 guests → phone the restaurant
- The ten allergen checkboxes: Peanuts, Tree Nuts, Shellfish, Fish, Eggs,
  Milk/Dairy, Soy, Wheat, Gluten, Sesame
- Three required consents, wording verbatim, plus optional marketing

Worth noting why the client asked for an occasion dropdown: the old
`booking_occasion` was a free-text field, and on **Leicester it was typed as a
telephone number**. Now a 12-option dropdown, editable in the admin.

## Zero new dependencies

Stripe via `fetch` against its form-encoded REST API; webhook signatures via
`node:crypto` HMAC-SHA256 over `timestamp.body` with a constant-time compare and
a 5-minute replay window; email via Resend's HTTP API or a JSON webhook. No SDK,
nothing with a postinstall script — the constraint that bit in week one still
holds, and card details never touch the site either way.

## Demoable before any accounts exist

- **No Stripe key** → `/checkout-simulator` stands in, clearly labelled, with
  both a success and a failure button. It 404s the moment a real key is set.
- **No email provider** → every email is written to `data/outbox/*.txt`, so you
  can read exactly what a guest receives.

This is what lets the client walk the whole journey, failure path included,
without waiting on Stripe verification or DNS.

## migrate.mjs, rewritten again — and this one was a real latent bug

The staleness probe only knew about 0000-era columns. Once a genuine incremental
migration (0001) existed, an already-current database would report "nothing to
apply" and **silently skip 0001**. Worse, "move aside and rebuild" was
acceptable while every row came from the seed; it is not acceptable now that
bookings, deposits and audit history are real customer data.

Now three explicit modes, all tested including data survival:

| Mode | When | What happens |
|---|---|---|
| fresh | no database | apply every migration in journal order |
| incremental | has `__migrations` | apply only what's unapplied |
| adopt | right shape, no tracking table | baseline it as 0000, apply what came after |
| rebuild | too old to reconcile | move aside loudly, never delete, tell you to re-seed |

## 52 e2e assertions, all passing against a production build

Availability rules · blocked dates closing a day with the manager's reason ·
capacity genuinely refusing a slot at 21/20 covers · the 12-guest ceiling ·
deposit maths (£10 × 4 = £40) · the held→confirmed transition · **no
confirmation email before payment succeeds** · the failure path releasing the
table and emailing the guest · token-protected guest cancellation · a wrong
token exposing nothing · admin showing occasion, allergens and deposit state ·
a forged webhook rejected with 400.

## Flagged rather than silently implemented

- **Deposit on every booking** is a change from their published Fri/Sat/Sun
  policy, with a conversion cost on quiet weeknights. Shipped as asked; one
  switch in Admin → Settings reverts it, and the settings screen says so.
- **Covers per sitting (40 Birmingham / 20 Leicester) is a starting guess.** The
  old site had no capacity limit at all, so there is no real figure to inherit.
  The restaurant needs to supply theirs.

## New files

`src/lib/booking-config.ts` · `availability.ts` · `stripe.ts` · `email.ts` ·
`booking.ts` · `data/booking.json` · `.env.example` ·
`(site)/[branch]/book-online/{page,actions,confirmed,unconfirmed}` ·
`(site)/[branch]/booking/[reference]/{page,actions}` ·
`api/stripe/webhook/route.ts` · `checkout-simulator/page.tsx` ·
`(dash)/admin/settings/{page,actions}` · migration `0001_remarkable_timeslip`.
