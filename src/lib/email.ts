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

/** The address every message is sent from, and why it is worth being careful. */
export function mailFrom(): string {
  return process.env.MAIL_FROM ?? "reservations@varanasi.uk";
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

  if (process.env.MAIL_FROM || from !== "reservations@varanasi.uk") return null;
  return `Email is going out from ${from}, which is the built-in default — nobody has chosen it. `
    + "Resend refuses any address on a domain that has not been verified against the account, "
    + "so confirmations are being rejected. Verify a domain at resend.com/domains and set the "
    + "sending address to one on it.";
}

/** Write the message to data/outbox. Returns the file, or null if it couldn't. */
function writeToOutbox(mail: Mail, from: string, note?: string): string | null {
  try {
    fs.mkdirSync(OUTBOX, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = mail.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const file = path.join(OUTBOX, `${stamp}--${note ? "UNDELIVERED--" : ""}${slug}.txt`);
    fs.writeFileSync(file,
      (note ? `X-Delivery-Failure: ${note}\n` : "") +
      `From: ${from}\nTo: ${mail.to.join(", ")}\n` +
      (mail.replyTo ? `Reply-To: ${mail.replyTo}\n` : "") +
      `Subject: ${mail.subject}\nDate: ${new Date().toUTCString()}\n\n${mail.text}\n`);
    return file;
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
  const fromEmail = mail.fromEmail ?? process.env.MAIL_FROM ?? "reservations@varanasi.uk";
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
