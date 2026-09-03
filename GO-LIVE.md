# Varanasi — everything needed to go fully live

Three sections: the hosting decision, the Stripe setup, and everything else the
site needs before it can take a real booking.

---

## 1. Hosting — recommendation

**Railway or Render, with a persistent volume. Not Netlify.**

The app reads and writes SQLite **synchronously** — 181 query sites across 48
synchronous helper functions, none of them awaited. Every hosted database
(Turso, Neon, Supabase) is asynchronous, so moving to one is an async migration
of the whole data layer, including the booking and voucher paths where the money
is. A disk-backed host matches how the app is actually built and needs **no code
change at all**.

| | Railway | Render | Fly.io | VPS (Hetzner/DO) |
|---|---|---|---|---|
| Setup | ~30 min | ~30 min | ~1 hr | ~3 hrs |
| Cost | £4–15/mo | £6/mo+ | £4/mo+ | £4/mo+ |
| Persistent disk | Volume | Disk (paid tier) | Volume | Native |
| Best for | **Recommended** | Equally fine | More control | Full control |

### Railway, concretely

1. Push the repo to GitHub.
2. New Project → Deploy from GitHub repo. It detects Next.js.
3. Add a **Volume** mounted at `/app/data`.
4. Set `DATABASE_URL=/app/data/varanasi.db` plus the variables in section 3.
5. Upload the seeded `data/varanasi.db` into the volume once (Railway CLI, or a
   one-off deploy that copies it in).
6. Add your domain; DNS is a CNAME to the Railway target.

**Set up a backup before launch.** A nightly `cp data/varanasi.db` to object
storage, or `sqlite3 data/varanasi.db ".backup"` on a cron. That file holds every
booking, enquiry and voucher; on one volume it is a single point of failure.

The trade-off: SQLite on one volume means **one writable instance**, so no
horizontal scaling. For two restaurants that ceiling is nowhere in sight. If the
business ever reaches it, that is when the Postgres migration earns its cost.

---

## 2. Stripe — what you need

Good news: the integration is **already written and complete**. Hosted Checkout
for both table deposits and gift vouchers, plus a signature-verified webhook that
confirms the booking even if the guest closes the tab. It needs credentials, not
code.

Only **two** values are required. There is no publishable key, because guests are
redirected to Stripe's own page and card details never touch the site.

```
STRIPE_SECRET_KEY=sk_live_...        # or sk_test_ while testing
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Step by step

**a. Create/activate the account** — stripe.com. To take live payments Stripe
needs the company registration, the business bank account, and ID for a director.
Allow a few days for activation; you can do everything below in test mode
meanwhile.

**b. Get the secret key** — Dashboard → Developers → API keys → *Secret key*.
Start with `sk_test_`. Never commit it; it goes in the host's environment
variables only.

**c. Register the webhook** — Dashboard → Developers → Webhooks → Add endpoint.

- URL: `https://yourdomain.com/api/stripe/webhook`
- Subscribe to exactly these four events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
- Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

**The webhook is not optional.** It is what guarantees a paid booking gets
confirmed when the guest closes the tab on the Stripe page. Without it you will
take money and not confirm tables. Register it before going live.

**d. Test locally** before deploying:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Use card `4242 4242 4242 4242`, any future expiry, any CVC. Also test
`4000 0000 0000 0002` (declined) to confirm the table is released and nothing is
charged.

**e. Switch to live** — swap `sk_test_` for `sk_live_`, register a second webhook
against the live endpoint, and use its signing secret.

### How to tell it is working

Until `STRIPE_SECRET_KEY` is set, `/checkout-simulator` stands in for the payment
page. The moment the key is set, that route returns 404 and real Stripe Checkout
takes over. Nothing else changes. If you still see the simulator in production,
the key is not reaching the app.

The webhook is idempotent — Stripe re-delivers events, and a second delivery for
an already-confirmed booking does nothing and re-sends no email.

---

## 3. Everything else

### Required — the site cannot run correctly without these

| Variable | Where it comes from |
|---|---|
| `SITE_URL` | Your live domain, e.g. `https://varanasi.uk`. Builds the Stripe return links and the "manage your booking" links — wrong value breaks both. |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Signs admin sessions. |
| `DATABASE_URL` | Path on the persistent volume, e.g. `/app/data/varanasi.db`. |

### Email — required in practice

Guests get no confirmation without it, and the restaurant gets no alert.

- **Resend** (recommended): sign up, add `varanasi.uk`, publish the SPF and DKIM
  DNS records it gives you, create an API key.
  ```
  RESEND_API_KEY=re_...
  MAIL_FROM=reservations@varanasi.uk     # must be on the verified domain
  ```
- **Or** any webhook-based automation (Zapier, Make, n8n) via `MAIL_WEBHOOK_URL`.

With neither set, every email is written to `data/outbox` as a text file — fine
for testing, invisible to guests. **Verify the domain properly**; without SPF and
DKIM, confirmations land in spam.

### WhatsApp — optional, and the long pole

WhatsApp does not allow free-form messages outside a 24-hour window, and booking
confirmations and the after-dining follow-up are both outside it. Both need
**templates approved by Meta in advance**. That requires a Meta Business account,
a verified business, a WhatsApp Business number, and one approval per template.
**Allow one to two weeks.**

The exact wording to submit is in `src/lib/whatsapp.ts` (`TEMPLATE_BODIES`); the
template names the code expects are in `data/booking.json`.

```
WHATSAPP_TOKEN=            # Meta Cloud API
WHATSAPP_PHONE_ID=
# or Twilio: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM
```

Start this now if you want it at launch. Everything works without it — messages
queue to `data/outbox` — so it need not hold up go-live.

### Set in Admin → Settings, not environment variables

- **GA4 measurement ID.** There is no analytics on the current live site, so there
  is no historical baseline; installing at launch starts one. Nothing loads until
  a visitor accepts cookies, and no banner appears until an ID exists.
- **Google review links, per branch** — Google Business Profile → "Ask for
  reviews" → short link. Feeds the after-dining message.

### Content still needed from the client

1. **Catering copy.** The old page was an unpublished WordPress draft with no body
   text. Two neutral placeholder paragraphs are in place.
2. **Privacy policy: Leicester is not mentioned anywhere in it.** For a two-branch
   business taking personal data at both, that needs fixing before launch. Also
   confirm the named Data Protection Officer is still correct.
3. **Deposit policy contradiction.** The booking terms and the private-dining page
   state it differently. One must change.
4. **"Bhatti Ka Boti Kebab — Textures of Beetroot."** Capitalisation was corrected
   to match its siblings. Whether the wording is right is a kitchen question.
5. **Leicester room photographs.** Leicester has two published rooms to
   Birmingham's eight. More can be added in Admin → Private dining.

### Before switching DNS

- [ ] Change all three admin passwords from `ChangeMe!2026`
- [ ] `SESSION_SECRET` set to a real random value
- [ ] Stripe in live mode, webhook registered against the live URL
- [ ] One real card test end to end, then refund it
- [ ] Email domain verified; a booking confirmation received in a real inbox
- [ ] Database backup job running and a restore tested
- [ ] HTTPS enforced, HTTP redirecting
- [ ] `SITE_URL` matches the live domain exactly
- [ ] The old site's URLs redirecting — already built, see `src/lib/redirects.ts`
- [ ] `npm run test:e2e` passing against staging

---

## Realistic timeline

| | |
|---|---|
| Host set up, database on a volume, domain live | half a day |
| Stripe test mode, full booking + voucher test | half a day |
| Email domain verification (DNS propagation) | 1 day |
| Stripe live activation | 2–5 days (Stripe's timeline) |
| Client content — catering, privacy, deposits | their pace |
| WhatsApp template approval | 1–2 weeks (start early, not blocking) |

**Without WhatsApp, you can be live within a week** — the gating item is Stripe
account activation, which is Stripe's clock, not yours. Start that today.
