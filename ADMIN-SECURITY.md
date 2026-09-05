# Who sees what, and who is told

Three questions this answers: which restaurant an account can see, how a
sign-in is checked, and what reaches the owner when something changes.

---

## 1. Branch isolation

**A Leicester manager cannot see Birmingham, and the reverse.**

| Role | Sees |
|---|---|
| Owner | Both restaurants, plus Staff, Settings, Backups and the Activity log |
| Manager | Their own restaurant only: menus, rooms, bookings, dates, vouchers, enquiries |
| Staff | Their own restaurant only, read-mostly: look up and redeem vouchers, read bookings and enquiries |

### What was wrong

Every screen worked its own scoping out, with the same line each time:

```ts
const scoped = session.role !== "owner" && session.branchId != null;
```

That reads as *"scope non-owners"* and behaves as *"scope non-owners **who have
a branch**"*. The Staff screen offered "Both / none" as a branch for every role,
so a manager could be saved with no branch — and that account fell through to
**unscoped**. It saw both restaurants' figures on a page that told it
"you're seeing your own branch", and it could spend the other restaurant's gift
vouchers, because the redeem guard short-circuits on a null branch too.

### What it is now

One function, `visibleBranchIds(session)` in `src/lib/auth.ts`, is the only
answer to "which restaurants may this account see":

- owner → every branch
- non-owner with a branch → that branch
- non-owner without one → **an empty list**, which matches nothing

An account in that last state is a misconfiguration, not a permission level, so
`/admin` now says so on screen instead of showing zeros that read as "no
bookings". And the Staff screen no longer lets one be created: a manager or
member of staff must be attached to Birmingham or Leicester.

Where a screen still has to refuse — a Birmingham link opened by a Leicester
manager — it redirects to `/admin?denied=branch` and explains. It used to
`throw`, which rendered "Internal Server Error" and looked like a crash.

Gift vouchers are the one deliberate exception: a code from the other
restaurant can still be **checked** at either till, because a guest may present
one at the wrong door. The balance and validity show; the recipient's and
purchaser's names do not.

---

## 2. Sign-in

- The email address is validated before a password is compared, so a malformed
  address costs nothing and lands in the log legibly.
- **Five wrong passwords for one address, or twenty from one network address,
  within fifteen minutes, and that address is locked for fifteen minutes.**
  A correct password clears the count. The lock is per-process and resets on
  deploy — noted in `src/lib/login-guard.ts`; if the app is ever run as more
  than one instance this needs to move into the database.
- A real account and an unknown one get **the same refusal**, so the form
  cannot be used to work out who is employed here.
- The session cookie carries a fingerprint of the stored password hash and is
  re-checked against the database on every request. So deactivating an account,
  changing its role or branch, or resetting its password **takes effect
  immediately** — not whenever the seven-day cookie happens to expire.
- New accounts start on a shared password and cannot reach anything until they
  have replaced it.

Every sign-in, failed sign-in, lockout and sign-out is recorded.

---

## 3. What the owner is told

Everything staff do in the admin is written to the audit log. It is readable at
**Admin → Activity log** (owner only), searchable, filterable by person and by
area, and paged. Nothing can be edited or deleted from it.

Two things are also emailed:

**Straight away** — money, access, or personal data leaving the building:

- a staff account created, changed, deactivated, or its password reset
- any change to Settings
- a gift voucher issued by hand, or cancelled
- an enquiry export (a CSV of names, phones, dietary and allergy notes)
- a backup downloaded (the whole customer database in one file)
- a sign-in locked out after repeated failures

**Once a day** — one message covering every other change, grouped by who made
it, with nothing left out.

The split is deliberate. A busy Saturday produces hundreds of entries — every
booking status flip, every dish reordered — and a mailbox receiving four hundred
messages a day is a mailbox nobody reads. "The owner is told about everything"
would then be true on paper and false in practice.

### Where the mail goes

`OWNER_EMAIL` first (several addresses, comma-separated). Failing that, every
active owner account. Failing that, the booking notification addresses in
Admin → Settings. The Activity log page states which of these is in force, and
warns if there is nowhere to send.

With no email provider configured the messages are written to `data/outbox` as
readable `.txt` files instead of sent, so the wording can be checked first.

The daily summary arms itself on first run rather than mailing the entire back
catalogue, and its cursor only moves after a send succeeds — so a provider
outage delays a report rather than losing a day of it.

---

## 4. Forms that answer back

Most admin actions used to do neither half of this. On success they re-rendered
the same screen unchanged, which is what a broken button looks like. On bad
input they did something worse:

```ts
if (!guestName || !date || !time || !partySize) return;
```

A silent no-op. The manager typed a booking, pressed Add, the page came back
empty, and the booking did not exist.

Every action now ends in a green confirmation saying what happened, or a red
one saying what was refused and why. What that caught:

| Was accepted and stored | Now |
|---|---|
| party size `-5`, `100000`, `2.5` | refused, with the reason |
| date `banana`, `31/12/2026`, `2026-02-31` | refused |
| time `99:99` | refused |
| a booking dated last March | refused — "check the date" |
| a price typed as `14 / 18` or `TBC` | refused, instead of silently clearing the price |
| service times `22:00`–`09:00` | refused — it would take every date off sale |
| an empty notification address list | refused — nobody would be told about a booking |
| a closure with no times, or ending before it starts | refused — it would close nothing |
| a room closure for the *other* restaurant | refused |
| two menu sections with the same anchor | second is given a unique one |
| a room's minimum party above its maximum | refused |

Deleting a dish, a room, a photograph or a home-page tile, cancelling a
voucher, deactivating an account and resetting a password all ask first.
Cancelling a voucher twice — by double-click, back button or resend — is
refused rather than recorded twice.

---

## Proving it

`npm run test:e2e` signs in as a real Leicester manager, a real Birmingham
manager and a deliberately unassigned one, and checks each of the claims above
against the running site rather than against the source. 154 checks.
