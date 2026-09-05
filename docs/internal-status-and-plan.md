# Varanasi — status against the client's 3 Sept requirements list

Internal document. Maps every point in the client's latest email to what's
actually built, what's still open, and where the timeline/scope needs your
decision before it goes to them. The client-facing reply is in
`client-email-reply.md` — this is the working-out behind it.

## Headline: scope has grown since the 20-day plan / £9,450 quote

The 2 Sept proposal priced reservations and vouchers on the **platform route**
(Tablein/Eat App etc., 4 days each, £1,750 + £1,650) specifically because that
was the only way to hit a 20-day launch with Stripe payments live-tested.

This email asks for something bigger: **custom-built** reservations and
vouchers, *plus* a dedicated "customer facing app" and "backend admin app" —
closer to Option B in the original plan (custom booking engine), which the
20-day plan explicitly flagged as **not achievable in 20 days** with safe
payment testing.

What's actually been built so far (see below) already goes beyond the
platform-route plan — bookings, blocked dates and the admin portal are custom,
not a third-party embed — so the direction of travel has already shifted
toward custom without a re-quote. Two things worth deciding before the client
call:

1. **Is this still priced against the £9,450 bundle, or does it need
   re-quoting as the custom route (Option B pricing was never finalised)?**
2. **Does the 22 Sept launch date still hold if reservations+vouchers are
   custom with live Stripe?** The 20-day plan's own risk section says no —
   "custom routes chosen" was listed as the #1 slip risk, with the advice to
   move launch rather than ship a broken payment path.

Neither of these needs answering before the client call, but the call is a
much better place to have that conversation than an email — hence the reply
doesn't commit to a date for reservations/vouchers.

## Requirement-by-requirement status

| # | Client asked for | Status | Notes |
|---|---|---|---|
| 1 | Reservation system, both branches, Stripe, blocked dates | **Blocked dates: done.** Booking view/manual-entry: done. Availability logic, Stripe deposits, customer-facing booking flow: not started | Schema (`bookings`, `blocked_dates`) has existed since the build's first week. Admin can now view/manage bookings and block dates per branch (built today). No customer-facing booking form yet — currently falls through to `/exact` (the enquiry-only form). |
| 2 | Gift vouchers, values, sender/recipient, messages, expiry, redemption, Stripe | **Not started.** Schema exists (`vouchers`, `voucher_redemptions`) | Settings table already has default values, expiry months, min/max seeded — ready for a purchase flow once Stripe route is confirmed. |
| 3 | Private dining rooms correctly allocated | **Done and verified.** | This was a real, confirmed bug (Leicester showing Birmingham's 8 rooms; Birmingham's own page undercounting). Fixed with client's own published data, admin-editable. |
| 4 | Branch content clearly separated | **Done, verified today.** | Checked at data level: every branch-identifying field (address, phone, hours, hero, gallery, rooms) is branch-scoped in the schema and query layer, no cross-branch leakage. **One thing to flag to the client, not silently "fix": food and drinks menus are genuinely near-identical across branches on the live site (90/91 dishes shared, drinks 100% shared) — this is source-accurate, not a bug.** Confirm with them whether that's intentional (one kitchen) before assuming it needs to diverge. |
| 5 | Menus easy to update without dev work | **Done.** | Admin portal: three tabs (food/set/drinks) per branch, full CRUD, live republish on save. |
| 6 | Mobile optimisation | **In progress, foundational work done.** | Rebuilt pages are mobile-first Tailwind; the `.btn`-layer bug that broke mobile nav was caught and fixed in e2e testing. Reservations/vouchers UI mobile testing can't happen until those flows exist. |
| 7 | SEO & redirects | **Mapped, not yet wired.** | `meta/urls.tsv` from the live capture has the full URL list with current status/canonical/title — the redirect map input is ready, the actual redirect rules aren't written yet. |
| 8 | Customer data / marketing capture & storage | **Partially done.** | `enquiries` table exists and captures marketing consent; not yet wired to live contact/newsletter forms (still `/exact` pass-through). The 4,826-row ZPos enquiry export with `marketing_opt_in` is identified as the import source — not yet imported. |
| 9 | Website management access | **Live today.** | Owner/manager/staff roles, branch-scoped access, forced password change on first login (verified un-bypassable via e2e test), full audit log. Menus, drinks, private dining, bookings, blocked dates all editable now. |
| 10 | Full testing before launch | **Process defined (20-day plan), not yet at that stage.** | Staging UAT window was already scheduled for 17–19 Sept in the original plan — still the right mechanism, timing depends on #1/#2 above. |
| 11 | DNS / domain transfer | **Not started — waiting on ZPos, as they've now confirmed.** | Sequencing unchanged from the 20-day plan: TTL lowered a few days ahead of the agreed date, cutover at a time client chooses. |
| 12 | Seamless transition, no interruption | **Plan unchanged, achievable regardless of route.** | Old and new can run in parallel until DNS cutover either way. |

**New in this email, not in the original 12-point list:**

- "Customer facing app" + "backend admin app" specifically for reservations —
  read as reinforcing #1, not a new deliverable, but worth confirming with the
  client what they mean by "app" (web app, as everything here is, vs. a native
  mobile app — the latter is a materially different and larger scope).
- Root landing page (varanasi.co.uk) had no way back to itself from either
  branch site — **fixed today.** Genuine gap, not present in the original
  12-point list or the 2 Sept audit; the client caught something real.

## What shipped today, concretely

- Root-to-branch navigation gap closed: the branch header's city name, the
  mobile drawer, and the footer's "Our restaurants" list all now link back to
  `/`. Verified with an e2e pass (desktop header, mobile drawer, footer, three
  separate click-throughs to the chooser).
- Branch menu separation verified at the data level — not a bug, confirmed
  against the client's own live site content.
- Bookings admin: per-branch table view, filter by date or "all upcoming",
  manual entry for phone/walk-in bookings, status changes (confirmed → seated
  → completed / cancelled / no-show). No Stripe, no customer-facing form —
  this is the staff-facing half only.
- Blocked-dates admin: whole-branch or single-room closures, with a reason,
  all-day or a time window.
- Both wired into the existing role/audit-log system (`viewBookings` /
  `editBookings` abilities — staff can view, manager/owner can edit).
- All of the above built, typechecked, production-built and e2e-tested
  (15 assertions) before delivery — code pushed directly to Sathish's machine,
  database rebuilt and pushed alongside it. No manual npm steps required.

## Pushing code changes to Sathish's machine — what actually works

Tried piping base64-encoded file contents through `device_bash` echo/decode
commands (to avoid a full zip round-trip for a handful of changed files). It's
fragile: the base64 blob is long enough that copy/paste line-wrapping can
silently corrupt it (a stray space broke the decode on the first attempt), and
there's no verification step before it's already been "written". Abandoned it.

**What's reliable: `SendUserFile` the changed files into the conversation,
then `device_commit_files` to write each one to its real path**, the same
mechanism already proven for the database file. It worked cleanly for 9 files
at once (2 into brand-new admin subfolders — `device_commit_files` creates
the directories). No corruption risk, no manual escaping, and the tool call
itself confirms what was written. Use this for future code pushes rather than
base64-through-bash.

## Recommended next step

Get the 30-minute call in the diary before quoting anything further in
writing — reservations and vouchers timing depends on the client's answer to
"platform now, custom later" vs "custom from day one", and that's a
conversation, not an email thread.

