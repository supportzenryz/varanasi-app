# Production readiness — audited 5 September 2026

Audited against the live deployment at
`varanasi-app-production.up.railway.app`, not against this repository.

**Verdict: one thing must be fixed before anyone tests, and it is not in the
code.** Everything else is ready.

---

## 🔴 BLOCKER — there is no disk

The Railway service has **no volume attached**. `DATABASE_URL` is set, but with
nothing mounted it points at the container's own filesystem, which Railway
throws away and rebuilds on every deploy and every restart.

What that means today:

- **Every booking, enquiry, gift voucher and staff password change disappears
  the next time the service deploys.** Push a commit, and the restaurant's day
  is gone.
- **Gift vouchers are the sharp end.** A customer pays £100, receives a code,
  and the only record that the debt exists is that file. When it vanishes there
  is a customer holding a valid claim that nothing can verify.
- **The daily backups are protecting nothing.** They are written beside the
  database, so they are inside the same container, and they go with it. The
  Backups screen will look healthy right up until the moment it is needed.

Nothing in the application can work around this. It needs a disk.

### Fix

1. Railway → the project canvas → right-click `varanasi-app` → **Attach volume**
2. Mount path: **`/data`**
3. Confirm `DATABASE_URL` is **`/data/varanasi.db`** — it must sit inside the
   mount path, or the volume is mounted and unused.
4. Redeploy.
5. Prove it: make a test booking, redeploy, and check the booking is still
   there. If it is gone, the mount path and `DATABASE_URL` do not agree.

Do this before the client sees the site. Anything they enter before it is done
will be lost, and the first impression of a system that forgets bookings is
hard to undo.

---

## 🟠 The account is on a trial

The dashboard reads **"28 days or $4.88 left — Upgrade to keep your services
online."** A restaurant taking deposits cannot run on a trial that expires: when
the credit is gone the site goes down, and it goes down without warning to
anyone about to book a table.

Upgrade before the domain points here. It is also what unlocks the headroom
this app wants — the volume, and more than one replica if it is ever needed.

---

## 🟢 Everything else checked out

| | |
|---|---|
| Deployment | Online, EU West, deployed from `main` automatically |
| All eight environment variables | Present, including both Stripe values |
| Both restaurants' pages | Every page returns 200 with the right content |
| Images | Every one decodes on both home pages |
| Booking calendar | Live, showing blocked and unavailable dates |
| Admin | Every screen behind the sign-in, including the new Activity log and Erasure screens |
| Stripe webhook | Reachable, and correctly refuses an unsigned request |
| Mobile and tablet | No sideways scroll on any page checked |
| JavaScript errors | None |
| Broken links or missing assets | None |

Run it yourself, any time, against anything:

```bash
BASE_URL=https://varanasi-app-production.up.railway.app npm run test:production
```

That is a read-only check. It books nothing, signs in to nothing and writes
nothing, so it is safe against a live restaurant. Run it after every deploy.

---

## The three suites, and what each is for

| Command | Checks | Needs |
|---|---|---|
| `npm run test:production` | A **deployed** site, through a browser only | Just the URL |
| `npm run test:e2e` | A **build**, including the database and admin | A local server |
| `npm run test:validate` / `test:stripe` | Money, contact details, dates, Stripe signatures | Nothing |

The distinction matters: `test:e2e` reads the local SQLite file, so pointing it
at Railway would have it reading this machine's database while judging a server
in Amsterdam. Use `test:production` for deployments.

---

## Before the domain moves to varanasi.uk

1. Verify **varanasi.uk** in Resend → Domains, then set `MAIL_FROM` to
   `reservations@varanasi.uk`. Until then email must send from a verified
   address or the provider rejects every message.
2. Add a **second Stripe webhook** for the new domain rather than editing the
   existing one, so the Railway URL keeps working while you switch.
3. Set `SITE_URL` to the live domain. It builds the payment return links and
   the "manage your booking" link in confirmation emails; wrong, and a guest
   who has just paid lands nowhere.
4. Move Stripe from the sandbox to live keys — **both at once**. The secret key
   alone charges real cards while the webhook that confirms the booking is
   missing, so the guest pays and still loses the table.
5. Re-run `npm run test:production` against the new domain.
