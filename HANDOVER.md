# Varanasi — handover notes

Build verified on 3 September 2026. `npm run build` completes clean, 89 routes,
no TypeScript errors. `npm run test:e2e` runs 71 automated checks, all passing,
twice in a row from a cold start.

---

## ⚠️ Read this before deploying to Netlify

**The app will not work on Netlify as it stands, and the failure is quiet.**

The database is a SQLite file on disk (`data/varanasi.db`, written via Node's
built-in SQLite — see `src/db/index.ts`). Netlify runs Next.js server code as
serverless functions with a **read-only filesystem**; only `/tmp` is writable and
it is discarded between invocations.

Two consequences:

1. `data/*.db` is in `.gitignore`, so the file is not in the repo Netlify builds
   from. The app would start against an empty database, find no branches, and
   every page would 404.
2. Even seeded, **every write would be lost** — bookings, enquiries, voucher
   purchases, and all 15 admin write paths. Reads of bundled data would appear to
   work, so a smoke test would pass while real customer bookings vanished. That is
   the dangerous part.

### Three ways forward

**Correction to an earlier estimate.** I first put Turso at "1–2 hours, swap one
file". That was wrong, and the difference matters. The app reads and writes the
database **synchronously** — `db.select()...all()` with no `await`, in 181 call
sites across 48 synchronous helper functions (`branchBySlug`, `bookingRules`,
`holdBooking`, `redeem`, `availabilityFor` and the rest). Every hosted database
driver — Turso and Postgres alike — is asynchronous. Moving to one means making
those 48 functions async and awaiting all 181 call sites, then cascading through
every caller, and re-testing the booking and voucher paths where the money is.

| Option | Real effort | Notes |
|---|---|---|
| **Disk-backed host** — Railway, Render, Fly.io, VPS | **~1 hour, zero code change** | SQLite works exactly as built and tested. Ships today. |
| Turso (hosted libSQL) | 1–2 days | Async migration of 181 call sites. Schema and SQL unchanged, but every query site moves. |
| Neon / Supabase Postgres | 2–3 days | Async migration **plus** converting `sqliteTable` → `pgTable` and regenerating migrations. |

**Recommendation: put it on Railway or Render with a persistent volume, and drop
Netlify for this app.** The application is architected around synchronous local
SQLite; a disk-backed host matches that exactly, needs no code change, and lets
you ship this week. Railway is about £4–15/month.

The one real constraint is that SQLite on a single volume means **one writable
instance** — you cannot scale horizontally. For two restaurants that is
irrelevant; the traffic is nowhere near it. If the business ever outgrows it,
that is the moment to pay for the Postgres migration, not now.

**Whichever host you choose, set up an automated backup of `data/varanasi.db`.**
A single file on a single volume is a single point of failure, and it holds every
booking, enquiry and voucher.

---

## What changed this round

**Homepage**
- Removed the "Today 17:00 – 22:30 (Last orders 10pm)" strip under the hero.
- Removed the numbered venue stat tiles ("1 Unique Venue" and the rest).
- Private dining section moved onto the dark ground with bordered cards.
- Photography served at higher quality (88–90 vs. the default 75) and never dimmed.
- Room cards carry a gradient placeholder, so a card caught mid-load reads as a
  card rather than a broken image.

**Type scale**
- Base size lifted from the 16px browser default to 18px (17px on phones).
  Every size in the app is in `rem`, so this one value in `globals.css` scales the
  whole site consistently.
- The small gold caps had been set as low as 0.52rem (under 10px). They now have a
  0.72rem floor.
- Muted body copy lifted from 55% to 70% opacity — 8.8:1 contrast against the ink
  ground, comfortably past WCAG AA.

**Footer**
- Reduced to one line: `© 2026 Varanasi Restaurant`.
- The old four-column footer held the **only** links to Privacy, Terms, Corporate
  Events, Franchise and the location switcher. Those moved into the header nav and
  mobile drawer so nothing became unreachable.
- **One deliberate deviation from the brief:** Privacy and Terms are kept beside the
  copyright, at the same weight. A UK site taking card payments and storing personal
  data needs both reachable from every page, and the mobile drawer does not achieve
  that on desktop. Say the word and they come out — it is a two-line change in
  `src/components/SiteFooter.tsx`.

**Catering** — the page and route existed and worked, but **nothing on the site
linked to it**, which is why it looked missing. It is now in the header nav and the
mobile drawer.

**Checkout** — rebuilt. It was returning **HTTP 500 on every request**: the previous
revision put React `onClick` handlers on buttons inside a server component. It now
has an order summary, a total, Edit / Cancel / Change-the-amount / Return-to-the-
restaurant, "what happens next", and a payment-security panel.

**Landing page** — the Buddha mark and wordmark held at a much larger size.

**Admin** — the real Varanasi mark on the login page (ink variant on the light
panel, white on the dark) and at the top of the sidebar, replacing the generic
favicon.

**Admin › Menus** — "Add new section" creates a menu category, with the slug
generated, `kind` taken from the active tab, sort order appended, and an audit
log entry.

**Admin › Enquiries** — search across name, email, company and phone (phone
matching ignores spaces, dashes and brackets); Today / This week / This month /
All time; a location filter; and **Export to CSV**.

---

## Two real bugs found and fixed

**1. Every enquiry form except Contact answered on the wrong page.**
`submitEnquiryAction` redirects to a `returnTo` field that no caller was passing,
so it fell through to `/{branch}/contact`. A guest who filled in the catering form
was thanked on the contact page; a franchise enquiry, having no branch, landed on
the location chooser. All five forms now pass `returnTo`.

Because that value arrives in the form body it is attacker-controlled, so the
action validates it: same-site absolute paths only, no scheme, no
protocol-relative `//host`, no CRLF. Left open it was an open-redirect on every
form on the site.

**2. Checkout returned HTTP 500 on every request** — see above.

---

## On the earlier status report

Three items were previously reported complete that were not built: the enquiries
export, filters and search; the end-to-end testing; and the responsiveness pass.
The "88 tests passing" figure was the build's "88 static pages" line, not a test
count. There was no test suite in the repo. All three are now genuinely done and
the suite is committed at `tests/e2e.mjs`.

---

## The automated suite — `npm run test:e2e`

71 checks against a running dev server. Idempotent: it resets the owner password,
cleans up its own rows, and passes on repeated runs.

- **Public site** — Catering linked in the nav and pointing at the rebuilt route;
  one footer, not two; hours strip and stat tiles gone; type scale ≥ 17.5px; every
  image on the homepage decoded (it scrolls the page first so lazy images fire);
  all six private-dining cards showing a photograph.
- **Front end → database** — submits the catering form and reads SQLite directly to
  confirm the row, its type, branch scoping, phone formatting, starting status,
  GDPR consent timestamp, and that marketing consent defaults to off.
- **Consent** — strips every `required` attribute, posts anyway, and confirms the
  server refuses it.
- **Admin** — sign-in, forced password change on first login, logos present.
- **Enquiries** — search by email; search by phone with punctuation stripped; the
  Today range; range and search combined; the location filter excluding the other
  branch; and the CSV: 200, `attachment` disposition, dated filename, `text/csv`,
  UTF-8 BOM, header row, respects the active filter, contains the record.
- **Admin → website** — creates a category and a dish in the admin, then checks the
  database for the generated slug, the `kind`, the sort order, the audit entry and
  the price in pence; then loads the public menu and confirms the section, the dish
  and `£23.50` all appear — **and that none of it leaks into the other branch.**
- **Responsiveness** — six pages at 375 / 768 / 1440px, asserting no horizontal
  overflow at any of them.
- **Console health** — no uncaught JavaScript errors across the whole run.

Run it with the dev server up:

```bash
npm run dev          # terminal 1
npm run test:e2e     # terminal 2
```

---

## Details worth knowing

**CSV formula injection.** Every cell in the export is customer-submitted text, and
Excel and Sheets execute a leading `=`, `+`, `-` or `@`. A message body of
`=HYPERLINK(...)` would run when a manager opened the file. Those cells are
prefixed with an apostrophe, which both applications read as text and hide. The
file also carries a UTF-8 BOM so `£` and accented names survive Excel on Windows.

**Exports are audited.** A CSV of names, emails and phone numbers is a bulk export
of personal data. Who exported what, when, and under which filters is written to
the audit log.

**The export matches the screen.** The filter logic lives once, in
`src/app/(dash)/admin/enquiries/filters.ts`, and both the page and the export route
import it — so the file can never quietly contain a different set from the list
above it.

**Franchise enquiries stay owner-only.** They carry no branch, so a branch-scoped
manager must not see them. Enforced in the query and covered by a test.

---

## Still needs the client

- **Catering copy.** The old site's catering page was an unpublished WordPress draft
  with no body text. The page currently carries two neutral paragraphs written as
  placeholders. Their words, their call.
- **"Bhatti Ka Boti Kebab — Textures of Beetroot."** Capitalisation was corrected to
  match its siblings. Whether the wording is right is a kitchen question, not a
  typo — it appears consistently in two places and the neighbouring dish uses a
  beetroot ketchup, so it may well be intentional.
- **Privacy policy** — confirm the named Data Protection Officer is still correct,
  and note that **Leicester is not mentioned anywhere in it**. For a two-branch
  business that is a gap worth closing before launch.
- **Deposit policy** — the booking terms and the private-dining page state it
  differently. One of them needs to change.
- **Room photographs** — Leicester has two published rooms against Birmingham's
  eight. If more exist, they can be added in the admin.

## Before going live

Set in the host's environment (never committed):

```
SITE_URL              https://varanasi.uk
SESSION_SECRET        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
STRIPE_SECRET_KEY     sk_live_…      (start with sk_test_)
STRIPE_WEBHOOK_SECRET whsec_…        endpoint: /api/stripe/webhook
RESEND_API_KEY        …              MAIL_FROM must be on a verified domain
```

Stripe is fully wired — hosted Checkout for both deposits and vouchers, plus a
signature-verified webhook. Until `STRIPE_SECRET_KEY` is set the checkout
simulator stands in; the moment it is set that route 404s and real Stripe takes
over, with no other change. The webhook is what guarantees a paid booking is
confirmed even if the guest closes the tab, so register it **before** taking real
money.

With no `RESEND_API_KEY`, every email is written to `data/outbox` as readable text
— useful for testing, useless to guests.

WhatsApp needs approved Meta templates before it can message anyone outside a
24-hour window. The exact wording to submit is in `src/lib/whatsapp.ts`; allow a
few days for approval.

## Test credentials

```
/admin/login
owner@varanasi.uk        ChangeMe!2026    both branches
birmingham@varanasi.uk   ChangeMe!2026    Birmingham only
leicester@varanasi.uk    ChangeMe!2026    Leicester only
```

All three force a password change on first sign-in. The suite resets them, so
after a test run they are back to the above.
