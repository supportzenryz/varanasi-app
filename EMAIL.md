# Email notifications

Every message below is already written and already firing. Without a provider
key they are saved to `data/outbox/` as readable `.txt` files instead of being
delivered — which is how the whole journey was demonstrated before any account
existed. Turning them into real email is one variable.

---

## Who gets told what

Both sides, on every outcome. Verified end to end in `npm run test:e2e`.

| What happened | The guest | The restaurant |
| --- | --- | --- |
| Booking confirmed (deposit paid) | confirmation + manage link | new booking, with covers and time |
| Deposit payment failed | told nothing is held, invited to retry | told, so the booking can be rescued by phone |
| Guest cancels online | written confirmation | cancellation notice |
| Enquiry sent (any form) | acknowledgement | the enquiry, reply-to set to the guest |
| Gift voucher bought | receipt to the buyer | voucher sold, with the code |
| Voucher delivered | the voucher, to the recipient | — |
| After dining | thank-you + review link | — |

The last two rows in the "restaurant" column are deliberately blank: a voucher
delivery and a thank-you are not events anyone needs to action.

Where the restaurant's copies go is set in the admin under **Settings**, not
here — `booking_rules.notifications.to`. It takes more than one address.

---

## Setting up Resend

**1. Create the account.** [resend.com](https://resend.com) → sign up. The free
tier is 3,000 emails a month and 100 a day, which is comfortably more than two
restaurants generate.

**2. Add the domain.** Domains → **Add Domain** → `varanasi.uk`.

Do *not* use the `onboarding@resend.dev` sender for anything real. It works
immediately, but the address is visibly not yours and it cannot be used for
guest-facing mail.

**3. Add the DNS records.** Resend shows three or four records — an MX and a
TXT for receiving/SPF, plus a `resend._domainkey` TXT for DKIM. Add them at
whoever hosts `varanasi.uk`'s DNS.

DKIM is not optional in practice. Without it, Gmail and Outlook put booking
confirmations in spam, and a confirmation in spam is a guest who thinks the
restaurant never replied. Propagation is usually minutes; allow up to a few
hours before assuming something is wrong.

**4. Wait for Verified.** Resend polls; the domain flips to **Verified** on its
own. Nothing sends properly until it does.

**5. Create the API key.** API Keys → **Create API Key**. Sending permission is
enough — it does not need full access. Copy it once; Resend will not show it
again.

**6. Set two variables.**

Locally, in `.env.local`:

```
RESEND_API_KEY=re_your_key_here
MAIL_FROM=reservations@varanasi.uk
```

On Railway, in the service's **Variables** panel, the same two.

`MAIL_FROM` **must** be on the verified domain. Resend rejects anything else,
and the rejection is per-message — mail simply stops arriving with nothing
obvious on the site to explain it.

**7. Restart.** `Ctrl+C` and `npm run dev` locally; Railway redeploys itself.
Next reads environment variables once at boot, so editing the file while the
server runs changes nothing.

---

## Checking it works

Send a real enquiry through `/birmingham/contact` using an address you can
read. Two emails should follow: the acknowledgement to you, and the enquiry
itself to whatever is in Settings.

Then confirm which mode is live:

```bash
ls -t data/outbox | head -3
```

New files still appearing means the key is not being read — the outbox is the
fallback, so it only fills when nothing else is configured. Resend's own
dashboard has a **Logs** page showing every attempt, with the reason for any
rejection; that is the first place to look if mail stops.

---

## If it isn't arriving

- **Still landing in `data/outbox/`** — the key is not set, or the server was
  not restarted after setting it.
- **Resend logs show the send but nothing arrives** — check spam, then check
  the domain really is Verified. Unverified domains are accepted and silently
  dropped.
- **Resend rejects with a `from` error** — `MAIL_FROM` is not on the verified
  domain.
- **The guest gets their copy, the restaurant does not** — the addresses live
  in the admin under Settings, not in the environment.

---

## WhatsApp, for later

Also built, also currently writing to the outbox. It needs more than a key:
Meta only allows messages outside a 24-hour reply window if the wording was
approved in advance as a template, and booking confirmations always fall
outside it. That means a Meta Business account, a verified business, a
WhatsApp Business number, and one approval per template — allow days.

The exact wording to submit is in `src/lib/whatsapp.ts` (`TEMPLATE_BODIES`),
and the names the code expects are in `data/booking.json` under
`whatsapp.templates`. Until then every message is written to `data/outbox`, so
the wording can be reviewed before it is ever submitted.
