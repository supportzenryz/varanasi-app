# Varanasi — complete site flows

Every journey on the website, what's built, and what each one still needs.
Written 3 September 2026.

Legend: **Live** = built and tested · **Partial** = usable, pieces missing ·
**Designed** = flow decided, not built yet.

---

## 1. Reservations — **Live**

The old site had no booking system at all: "Book Online" was an email form with
a fixed time dropdown, no availability, no covers limit, and a hardcoded Stripe
payment link pasted into the confirmation email. This replaces all of it.

### How it was designed

Modelled on how the established platforms (OpenTable, ResDiary, SevenRooms,
Tock, Resy) actually run a booking, because that pattern is what guests now
expect:

1. **Search first, form second.** Party size and date first, then real
   availability. Nobody fills in a form to be told "we're full".
2. **Times as buttons, not a dropdown.** Available slots are tappable; full or
   too-late ones are visibly crossed out rather than hidden, so guests can see
   the restaurant is busy and pick around it.
3. **Prepayment as the confirmation.** Tock's model: the deposit *is* the
   booking. No payment, no table.
4. **Hold the table while they pay,** and release it if they don't.
5. **Ask everything the kitchen needs** — occasion, allergens, notes — at the
   point the guest is already committed, not before.

### The flow

```
/[branch]/book-online
  │
  ├─ Step 1  Guests (1–12) + date
  │            > 12 guests → "call us on <branch number>"
  │
  ├─ Step 2  Live slot picker, 5:00pm–10:00pm every 30 min
  │            checks: opening hours · blocked dates · covers already booked
  │                    · 90-min lead time · 180-day horizon
  │            unavailable times shown struck through
  │
  ├─ Step 3  Name · phone · email · occasion (dropdown) · 10 allergens
  │            · notes · 3 required consents · optional marketing
  │            Deposit stated in full before they commit: £10pp × guests
  │
  ├─ HOLD    Booking saved as `held`, deposit `required`,
  │            table off the market for 20 minutes
  │
  ├─ PAYMENT Stripe Checkout (Stripe's own hosted page — card details never
  │            touch this site).  Without Stripe keys, a clearly-labelled
  │            simulator stands in so the journey can be demoed today.
  │
  ├─ SUCCESS ──> /book-online/confirmed
  │            booking → `confirmed`, deposit → `captured`, timestamped
  │            guest emailed confirmation + manage link
  │            restaurant emailed alert
  │            appears in the admin immediately
  │
  └─ FAILURE ──> /book-online/unconfirmed
               "Your payment wasn't completed. Your booking has NOT been
                confirmed and no table is being held. Nothing has been charged."
               table released instantly · guest emailed the same
               offered: try again, or the phone number
```

### Guest self-service

`/[branch]/booking/<reference>?t=<token>` — the link in their confirmation
email. Shows the booking, cancels it, and points them at the phone for date
changes (so the deposit can be moved rather than lost). The token is required:
a guessed reference shows nothing.

### Payment correctness

This is the part that has to be right, so it follows Stripe's documented
fulfilment pattern rather than a shortcut:

- **The webhook is the authority.** `/api/stripe/webhook` handles
  `checkout.session.completed`, `async_payment_succeeded`,
  `async_payment_failed` and `expired`. A guest who pays and immediately closes
  the tab still gets confirmed — the tab is not what confirms a booking.
- **The return page also fulfils**, because webhooks can lag by seconds and the
  guest is standing there wanting an answer.
- **Both paths are idempotent.** Whichever arrives first confirms; the second
  does nothing and re-sends no email.
- **Signatures are verified** (HMAC-SHA256 over `timestamp.body`, constant-time
  compare, 5-minute replay window). Forged webhooks are rejected with 400 —
  tested.
- **`payment_status` is checked**, not just the event name, so a delayed payment
  method doesn't confirm a table before the money actually clears.

### What the restaurant controls (Admin → Settings)

Deposit policy (every booking / weekend nights only / never), deposit amount,
minimum party for a deposit, how long a table is held, sitting times and
interval, covers per sitting per branch, largest party online, lead time,
booking horizon, the occasion dropdown, and where alerts are emailed.

### Deliberate flag

Their published policy is a deposit on **Friday, Saturday and Sunday only**.
As requested, it currently takes one on **every** booking. That's a commercial
choice with a conversion cost on quiet weeknights — one switch in Settings puts
it back. Worth a conscious decision rather than a default.

---

## 2. Reservations, staff side — **Live**

`/admin/bookings` — per branch, by date or all upcoming. Shows time, reference,
guest, contact, occasion, allergens (in red), notes, party size, deposit amount
and payment state, and source. Staff can log phone and walk-in bookings, and
move a booking through confirmed → seated → completed → cancelled / no-show.
Covers total per view. Unpaid holds are swept automatically, so the list only
ever shows real bookings.

`/admin/dates` — close a whole branch or a single private room, all day or for
a window, with a reason. Feeds straight into what guests can book.

---

## 3. Notifications — **Live (needs an email provider to send for real)**

| Trigger | Goes to | Contains |
|---|---|---|
| Deposit paid | Guest | Confirmation, full details, deposit paid, manage/cancel link |
| Deposit paid | `sathish@zenryz.com` (configurable) | Full booking, allergens, occasion, marketing consent, admin link |
| Payment failed | Guest | Not confirmed, nothing charged, how to retry |
| Guest cancels | Restaurant | What was cancelled |

Currently every email is written to `data/outbox/` as a readable text file
instead of being sent — so you can see exactly what a guest receives before any
account exists. Set `RESEND_API_KEY` (or a `MAIL_WEBHOOK_URL`) and they send for
real, no code change. Change the recipient in Admin → Settings.

---

## 4. Menus — **Live**

`/[branch]/menu` (food + set menus) and `/[branch]/drinks` (24 categories, two
price points for wines and spirits). 226 dishes and 286 drinks, transcribed from
the client's own pages and drinks PDF. Fully editable in `/admin/menu` —
price, description, allergen codes, order, show/hide — and public pages
republish on save.

Both branches currently serve the same menu, which matches the live site (90 of
91 dishes identical). Per-branch divergence needs no work — just editing.

---

## 5. Private dining — **Live**

`/[branch]/private-dining-experiences` — 8 Birmingham spaces, 2 Leicester rooms,
each with real photography, capacity, deposit, hire charge and set-menu note.
Editable in `/admin/rooms`. This is where the old site's worst content bug was:
Leicester displayed Birmingham's room list. Fixed.

Room *enquiries* still route to the old form — see 7.

---

## 6. Gift vouchers — **Designed, not built**

Next major piece. Database tables (`vouchers`, `voucher_redemptions`) and the
value/expiry settings already exist. Designed flow:

```
/[branch]/gift-vouchers
  └─ Choose value (£25–£200 or custom) · recipient name/email · sender ·
     personal message · delivery date
       └─ Stripe Checkout (same hosted-page pattern as deposits)
            ├─ Paid    → unique code generated · PDF voucher emailed to
            │             recipient (or held until the delivery date) ·
            │             receipt to purchaser · logged in admin
            └─ Failed  → "not purchased, nothing charged"

/admin/vouchers  → issue manually · look up by code · redeem (full or partial,
                   balance tracked) · expiry · cancel
Staff redemption → search by code at the till, mark the amount used
```

Worth knowing: the outgoing vendor has confirmed **no record of past voucher
sales exists**. Unredeemed voucher liability is currently unquantifiable — ask
ZPos before their systems are switched off.

---

## 7. Enquiry forms — **Partial (still the old forms)**

Five remaining forms (contact, private room, corporate, catering, franchise)
still fall through to the preserved copy of the old site. The `enquiries` table
and consent capture are built and waiting; each form needs wiring to it, plus
the same email notification treatment as bookings. Straightforward work, no
open questions.

Also pending: importing the 4,826 historical enquiries from ZPos, filtered to
marketing opt-ins only.

---

## 8. Admin access — **Live**

Three roles, declared once and enforced server-side on every action:

| | Owner | Manager | Staff |
|---|---|---|---|
| Menus, drinks, rooms | ✓ | own branch | view |
| Bookings | ✓ | own branch | view |
| Blocked dates | ✓ | own branch | — |
| Settings, staff accounts | ✓ | — | — |

Branch scoping resolves from the record being edited, not from the submitted
form, so a manager can't reach the other branch by editing a form field.
First login forces a password change — and that's a real gate, not a banner
(verified by trying to walk around it). Every change is audit-logged.

Still to build: `/admin/staff` (account management), gallery and venue-stat
screens.

---

## 9. Static pages & SEO — **Partial**

Rebuilt: home, menu, drinks, private dining, gallery, book-online. Still served
from the preserved old site: corporate, catering, franchise, contact, privacy,
terms. Every URL matches the live site's, so nothing needs redirecting as pages
are converted.

The redirect map input exists (`meta/urls.tsv`, 131 URLs including 88 dish
stubs) but the rules aren't written yet. Needed before launch to protect
rankings.

---

## 10. Going live — what's actually needed

**From the client**
- Stripe account access (whose name is the existing one in? If ZPos's, a new
  account plus verification is a real date risk)
- Confirmed addresses, phone numbers and opening hours per branch
- Sign-off on the deposit policy question above
- Covers-per-sitting figures (currently 40 Birmingham / 20 Leicester — a
  starting guess, not their number)
- Reservations inbox addresses to replace the test one

**From ZPos**
- Database export, DNS zone file, voucher history, Search Console access

**Technical**
- `SESSION_SECRET`, `SITE_URL`, Stripe keys + webhook endpoint, email provider
  (all documented in `.env.example`)
- Redirect rules
- Analytics (there is currently none at all — no baseline exists)

---

## Testing

The reservation flow ships with 52 automated end-to-end assertions covering
availability rules, blocked dates, capacity limits, the 12-guest ceiling,
deposit calculation, the held-then-confirmed transition, that **no confirmation
email is sent before payment succeeds**, the failure path releasing the table,
guest cancellation, token protection, admin visibility, and webhook signature
rejection. All passing against a production build.
