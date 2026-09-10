import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Sending email without adding a dependency.
 *
 * Three modes, chosen by what's in the environment:
 *   RESEND_API_KEY   -> Resend's HTTP API (a plain fetch, no SDK)
 *   MAIL_WEBHOOK_URL -> POST the message as JSON (Zapier/Make/n8n, or their own)
 *   neither          -> write the message to data/outbox/ and log it
 *
 * The outbox is what makes the booking flow testable today: every email the
 * system would send lands in `data/outbox` as a readable .txt file, so the
 * whole reservation journey can be demoed before anyone signs up to an email
 * provider or hands over DNS.
 */

export type Mail = {
  to: string[];
  subject: string;
  text: string;
  /** Optional HTML alternative. Plain text is always sent alongside it —
   *  every message here has to be readable without it. */
  html?: string;
  /** Extra headers. Used for List-Unsubscribe on the weekly marketing email,
   *  which Gmail requires of bulk senders and which every mail client turns
   *  into a one-press unsubscribe next to the sender's name. */
  headers?: Record<string, string>;
  replyTo?: string;
  fromName?: string;
  fromEmail?: string;
};

export type MailResult = { ok: boolean; via: "resend" | "webhook" | "outbox"; detail?: string };

const OUTBOX = path.join(process.cwd(), "data", "outbox");

export function mailMode(): MailResult["via"] {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.MAIL_WEBHOOK_URL) return "webhook";
  return "outbox";
}

/** The address used when nothing has chosen one. Kept in one place because
 *  two copies of it is how a warning ends up checking a different string from
 *  the one being sent. */
const DEFAULT_FROM = "reservations@varanasi.uk";

/** The address every message is sent from, and why it is worth being careful. */
export function mailFrom(): string {
  return process.env.MAIL_FROM ?? DEFAULT_FROM;
}

/**
 * What happened to the last message this process tried to send.
 *
 * Kept because a rejection is otherwise invisible from inside the product. The
 * failure that prompted this ran for a day and a half: a provider key was added
 * while the sending address was still on a domain nobody had verified, so every
 * confirmation was refused with a 403 in a terminal log, the settings screen
 * said "Sending live via resend", and the first anyone knew was a guest saying
 * they had never received anything.
 *
 * Deliberately a fact and not an inference. Whether a domain is verified is
 * knowable only by asking the provider, so rather than guess from the address,
 * this records the answer the provider actually gave. It resets on restart,
 * which the admin screen says, and `sendTestEmail` exists to produce one on
 * demand rather than waiting for a real booking to find out.
 */
export type LastMail = { ok: boolean; via: MailResult["via"]; detail?: string; subject: string; at: number };
let lastMail: LastMail | null = null;

export function lastMailResult(): LastMail | null {
  return lastMail;
}

/**
 * A warning about a configuration that provably cannot deliver.
 *
 * Only the case we can be certain of without asking the provider: a key is set
 * and the sending address has not been chosen at all, so it is the built-in
 * default on a domain that belongs to the restaurant's future website rather
 * than to anything verified today. Anything beyond that — is *this* domain
 * verified? — is the provider's to answer, and `sendTestEmail` asks it.
 */
export function mailConfigWarning(from = mailFrom()): string | null {
  if (mailMode() !== "resend") return null;
  const domain = from.split("@")[1]?.toLowerCase() ?? "";

  /* `onboarding@resend.dev` is not the safe testing choice it looks like, and
     this warning previously treated it as one. Resend accepts the address, so
     nothing is refused for being unverified — but it puts the account in
     sandbox mode, where the only permitted RECIPIENT is the address that owns
     the Resend account. A booking confirmation therefore fails on the guest,
     not on the sender:

       403 validation_error — "You can only send testing emails to your own
       email address (…). To send emails to other recipients, please verify a
       domain at resend.com/domains"

     Which is worse than the unverified-domain case, because the sending
     address now looks deliberately chosen. Say plainly that it reaches nobody
     but the account owner. */
  if (domain === "resend.dev") {
    return `Email is going out from ${from}, which is Resend's sandbox address. `
      + "Resend will only deliver it to the address that owns your Resend account — "
      + "every guest confirmation and every booking alert to anyone else is refused. "
      + "Verify a domain at resend.com/domains and set the sending address to one on it.";
  }

  /* This used to read `if (process.env.MAIL_FROM || from !== DEFAULT_FROM)`,
     which made a warning about one address depend on a different one. Every
     real send passes the address from Settings, so MAIL_FROM is only ever the
     fallback — yet setting it to anything at all silenced the warning about
     the Settings address, while the Settings address went on being refused.
     That is precisely the failure this function exists to catch, wearing a
     disguise. Judge the address you were handed. */
  if (from !== DEFAULT_FROM) return null;
  return `Email is going out from ${from}, which is the built-in default — nobody has chosen it. `
    + "Resend refuses any address on a domain that has not been verified against the account, "
    + "so confirmations are being rejected. Verify a domain at resend.com/domains and set the "
    + "sending address to one on it.";
}

/**
 * Ask the provider which domains it will actually accept mail from.
 *
 * Everything above is careful to say that whether a domain is verified is the
 * provider's to answer and not ours to guess. True — and the provider has an
 * endpoint for it, so the honest thing is to go and ask rather than to keep
 * saying it is unknowable. `GET /domains` costs one request and turns the
 * recurring day-and-a-half failure ("the key is set, the screen says sending,
 * every message is refused") into a sentence on the settings page naming the
 * domain that is wrong and the domains that would work.
 *
 * Degrades to `asked: false` rather than to a false accusation: a restricted
 * API key may not be allowed to read domains, and being unable to check is not
 * evidence of a problem.
 */
export type SendingDomain =
  | { asked: false; reason: string }
  | { asked: true; domain: string; verified: boolean; usable: string[] };

type DomainRow = { name?: string; status?: string };
let domainsCache: { at: number; rows: DomainRow[] | null; reason?: string } | null = null;
const DOMAINS_TTL = 5 * 60_000;

async function providerDomains(): Promise<{ rows: DomainRow[] } | { reason: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { reason: "no provider key is set" };
  if (domainsCache && Date.now() - domainsCache.at < DOMAINS_TTL) {
    return domainsCache.rows ? { rows: domainsCache.rows } : { reason: domainsCache.reason! };
  }
  const remember = (v: { rows: DomainRow[] } | { reason: string }) => {
    domainsCache = "rows" in v
      ? { at: Date.now(), rows: v.rows }
      : { at: Date.now(), rows: null, reason: v.reason };
    return v;
  };
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return remember({ reason: `the provider answered HTTP ${res.status} when asked` });
    const body = (await res.json()) as { data?: DomainRow[] } | DomainRow[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return remember({ rows });
  } catch (err) {
    return remember({ reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function checkSendingDomain(from = mailFrom()): Promise<SendingDomain> {
  if (mailMode() !== "resend") return { asked: false, reason: "no provider is connected" };
  const domain = from.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return { asked: false, reason: `"${from}" is not an email address` };
  const answer = await providerDomains();
  if ("reason" in answer) return { asked: false, reason: answer.reason };
  const usable = answer.rows
    .filter((d) => (d.status ?? "").toLowerCase() === "verified" && d.name)
    .map((d) => d.name!.toLowerCase());
  return { asked: true, domain, verified: usable.includes(domain), usable };
}

/** The warning above, then the provider's own answer. One sentence each. */
export async function sendingDomainWarning(from = mailFrom()): Promise<string | null> {
  const check = await checkSendingDomain(from);
  if (!check.asked || check.verified) return null;
  return `Your provider has not verified ${check.domain}, so every email sent from ${from} is refused. `
    + (check.usable.length
      ? `Verified on the account: ${check.usable.join(", ")}. Change the sending address below to one `
        + `on ${check.usable[0]} — reservations@${check.usable[0]}, for instance.`
      : "No domain on the account is verified yet — verify one at resend.com/domains first.");
}

/** Write the message to data/outbox. Returns the file, or null if it couldn't. */
function writeToOutbox(mail: Mail, from: string, note?: string): string | null {
  try {
    fs.mkdirSync(OUTBOX, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = mail.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

    /* The name has to be unique, and a millisecond is not.
     *
     * The stamp goes down to the millisecond, and two messages written inside
     * the same one produced the same filename — so the second silently wrote
     * over the first and the outbox was one message short. It went unnoticed
     * while every message here was a booking confirmation, which arrive one at
     * a time; the weekly marketing email sends to the whole list in a loop,
     * where same-millisecond writes are not an edge case but the normal
     * pattern. In outbox mode this file IS the record of what was sent, and a
     * record that drops entries under load is worse than no record.
     *
     * `wx` fails rather than overwrites, and the counter is only reached when
     * it does. */
    const base = `${stamp}--${note ? "UNDELIVERED--" : ""}${slug}`;
    const contents =
      (note ? `X-Delivery-Failure: ${note}\n` : "") +
      `From: ${from}\nTo: ${mail.to.join(", ")}\n` +
      (mail.replyTo ? `Reply-To: ${mail.replyTo}\n` : "") +
      `Subject: ${mail.subject}\nDate: ${new Date().toUTCString()}\n\n${mail.text}\n`;

    for (let n = 0; n < 1000; n++) {
      const file = path.join(OUTBOX, `${base}${n ? `--${n}` : ""}.txt`);
      try {
        fs.writeFileSync(file, contents, { flag: "wx" });
        return file;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    throw new Error("a thousand messages in one millisecond — something is wrong");
  } catch (err) {
    console.error(`[email:outbox] could not write "${mail.subject}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  const result = await deliver(mail);
  lastMail = { ok: result.ok, via: result.via, detail: result.detail, subject: mail.subject, at: Date.now() };
  return result;
}

async function deliver(mail: Mail): Promise<MailResult> {
  const fromName = mail.fromName ?? "Varanasi Restaurant";
  const fromEmail = mail.fromEmail ?? mailFrom();
  const from = `${fromName} <${fromEmail}>`;
  const mode = mailMode();

  try {
    if (mode === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from, to: mail.to, subject: mail.subject, text: mail.text,
          ...(mail.html ? { html: mail.html } : {}),
          ...(mail.headers ? { headers: mail.headers } : {}),
          reply_to: mail.replyTo,
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        // Logged, not just returned. Every caller awaits sendMail and ignores
        // the result — deliberately, because a booking must not fail when an
        // email does — which meant a provider rejection produced no email and
        // no trace of why. The most common cause is a `from` address on a
        // domain the provider has not verified, and that is invisible from
        // the website: the booking succeeds, the guest hears nothing.
        const body = await res.text();
        console.error(`[email:resend] REJECTED "${mail.subject}" -> ${mail.to.join(", ")}: HTTP ${res.status} ${body}`);
        console.error(`[email:resend] from was "${from}" — the usual cause is a domain the provider has not verified.`);
        // And keep the message. A rejection used to end here, so a
        // misconfigured provider was strictly worse than no provider at all:
        // with no key the message is written to data/outbox and can be read,
        // forwarded or resent, and with a key that the provider refuses it
        // simply ceased to exist. Writing it to the outbox anyway means the
        // content is never lost, and the file is the evidence of what should
        // have gone out.
        writeToOutbox(mail, from, `REJECTED by resend: HTTP ${res.status} ${body}`);
        return { ok: false, via: "resend", detail: `HTTP ${res.status}: ${body}` };
      }
      console.log(`[email:resend] sent "${mail.subject}" -> ${mail.to.join(", ")}`);
      return { ok: true, via: "resend" };
    }

    if (mode === "webhook") {
      const res = await fetch(process.env.MAIL_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...mail }),
        cache: "no-store",
      });
      if (!res.ok) {
        console.error(`[email:webhook] REJECTED "${mail.subject}": HTTP ${res.status}`);
        writeToOutbox(mail, from, `REJECTED by webhook: HTTP ${res.status}`);
        return { ok: false, via: "webhook", detail: `HTTP ${res.status}` };
      }
      console.log(`[email:webhook] sent "${mail.subject}" -> ${mail.to.join(", ")}`);
      return { ok: true, via: "webhook" };
    }

    // outbox
    const file = writeToOutbox(mail, from);
    console.log(`[email:outbox] ${mail.subject} -> ${mail.to.join(", ")} (${file ? path.basename(file) : "failed"})`);
    return { ok: Boolean(file), via: "outbox", detail: file ?? "could not write to data/outbox" };
  } catch (err) {
    // A booking must never fail because an email did. Log and carry on.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[email] failed to send "${mail.subject}": ${detail}`);
    return { ok: false, via: mode, detail };
  }
}
