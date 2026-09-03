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

export async function sendMail(mail: Mail): Promise<MailResult> {
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
      if (!res.ok) return { ok: false, via: "resend", detail: `HTTP ${res.status}: ${await res.text()}` };
      return { ok: true, via: "resend" };
    }

    if (mode === "webhook") {
      const res = await fetch(process.env.MAIL_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...mail }),
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, via: "webhook", detail: `HTTP ${res.status}` };
      return { ok: true, via: "webhook" };
    }

    // outbox
    fs.mkdirSync(OUTBOX, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = mail.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const file = path.join(OUTBOX, `${stamp}--${slug}.txt`);
    fs.writeFileSync(file,
      `From: ${from}\nTo: ${mail.to.join(", ")}\n` +
      (mail.replyTo ? `Reply-To: ${mail.replyTo}\n` : "") +
      `Subject: ${mail.subject}\nDate: ${new Date().toUTCString()}\n\n${mail.text}\n`);
    console.log(`[email:outbox] ${mail.subject} -> ${mail.to.join(", ")} (${path.basename(file)})`);
    return { ok: true, via: "outbox", detail: file };
  } catch (err) {
    // A booking must never fail because an email did. Log and carry on.
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[email] failed to send "${mail.subject}": ${detail}`);
    return { ok: false, via: mode, detail };
  }
}
