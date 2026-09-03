import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * WhatsApp messages, without adding a dependency.
 *
 * Two providers, chosen by what's in the environment:
 *   WHATSAPP_TOKEN + WHATSAPP_PHONE_ID  -> Meta's WhatsApp Cloud API
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM -> Twilio
 *   neither                             -> written to data/outbox as .whatsapp.txt
 *
 * Worth knowing before this goes live: WhatsApp does not let a business send
 * free-form text to someone who hasn't messaged them in the last 24 hours.
 * Outside that window you may only send a **template** that Meta has approved
 * in advance, which takes a Business Manager account, a verified business, and
 * a day or two for approval per template. Booking confirmations and the
 * after-dining follow-up are both outside the window, so both need approved
 * templates — the names are in `data/booking.json` under `whatsapp.templates`.
 *
 * Until that's done, the outbox mode below shows exactly what would be sent, so
 * the flow is testable and the client can see the wording to approve.
 */

export type WhatsAppMessage = {
  to: string;                       // E.164, e.g. +447700900123
  /** The approved template's name, for out-of-window sends. */
  template?: string;
  /** Ordered {{1}}, {{2}}… substitutions for the template. */
  variables?: string[];
  /** Plain text — only delivered inside the 24-hour window. */
  text?: string;
  /** What this message is, for logging and the outbox filename. */
  kind: string;
};

export type WhatsAppResult = { ok: boolean; via: "meta" | "twilio" | "outbox" | "skipped"; detail?: string };

const OUTBOX = path.join(process.cwd(), "data", "outbox");

export function whatsappMode(): WhatsAppResult["via"] {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) return "meta";
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) return "twilio";
  return "outbox";
}

/**
 * UK numbers as guests type them ("07700 900123", "+44 7700 900123") into the
 * E.164 form both providers require. Returns null if it can't be trusted —
 * better to send nothing than to message a stranger.
 */
export function toE164(raw: string | null | undefined, defaultCountry = "44"): string | null {
  if (!raw) return null;
  let n = raw.replace(/[^\d+]/g, "");
  if (n.startsWith("+")) return /^\+\d{8,15}$/.test(n) ? n : null;
  if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("0")) n = defaultCountry + n.slice(1);
  else if (!n.startsWith(defaultCountry)) n = defaultCountry + n;
  return /^\d{8,15}$/.test(n) ? `+${n}` : null;
}

export async function sendWhatsApp(msg: WhatsAppMessage): Promise<WhatsAppResult> {
  const to = toE164(msg.to);
  if (!to) return { ok: false, via: "skipped", detail: `unusable number: ${msg.to}` };

  const mode = whatsappMode();
  try {
    if (mode === "meta") {
      const body = msg.template
        ? {
            messaging_product: "whatsapp", to, type: "template",
            template: {
              name: msg.template,
              language: { code: "en_GB" },
              components: msg.variables?.length
                ? [{ type: "body", parameters: msg.variables.map((t) => ({ type: "text", text: t })) }]
                : undefined,
            },
          }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: msg.text ?? "" } };

      const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, via: "meta", detail: `HTTP ${res.status}: ${await res.text()}` };
      return { ok: true, via: "meta" };
    }

    if (mode === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const form = new URLSearchParams({
        To: `whatsapp:${to}`,
        From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
        Body: msg.text ?? renderTemplate(msg),
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        cache: "no-store",
      });
      if (!res.ok) return { ok: false, via: "twilio", detail: `HTTP ${res.status}: ${await res.text()}` };
      return { ok: true, via: "twilio" };
    }

    fs.mkdirSync(OUTBOX, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(OUTBOX, `${stamp}--whatsapp-${msg.kind}.txt`);
    fs.writeFileSync(file,
      `WhatsApp to: ${to}\nKind: ${msg.kind}\n` +
      (msg.template ? `Template: ${msg.template}\nVariables: ${JSON.stringify(msg.variables ?? [])}\n` : "") +
      `Date: ${new Date().toUTCString()}\n\n${msg.text ?? renderTemplate(msg)}\n`);
    console.log(`[whatsapp:outbox] ${msg.kind} -> ${to} (${path.basename(file)})`);
    return { ok: true, via: "outbox", detail: file };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] failed to send ${msg.kind}: ${detail}`);
    return { ok: false, via: mode, detail };
  }
}

/** Fills {{1}}, {{2}}… so the outbox and Twilio show readable text. */
function renderTemplate(msg: WhatsAppMessage): string {
  const base = TEMPLATE_BODIES[msg.template ?? ""] ?? msg.text ?? "";
  return base.replace(/\{\{(\d+)\}\}/g, (_, i) => msg.variables?.[Number(i) - 1] ?? "");
}

/**
 * The wording to submit to Meta for approval, kept here so the outbox shows
 * what a guest will actually read. Meta must approve these before any of them
 * can be delivered outside the 24-hour window.
 */
export const TEMPLATE_BODIES: Record<string, string> = {
  varanasi_booking_confirmed:
    "Hello {{1}}, your table at Varanasi {{2}} is confirmed for {{3}} at {{4}}, for {{5}} guests. " +
    "Your reference is {{6}} and your deposit has been received — it comes off your bill. " +
    "To change or cancel, please call us with 24 hours' notice.",
  varanasi_booking_reminder:
    "Hello {{1}}, we're looking forward to seeing you at Varanasi {{2}} tomorrow at {{3}}, for {{4}} guests. " +
    "Reference {{5}}. If anything has changed, please give us a ring.",
  varanasi_thank_you:
    "Thank you for dining with us at Varanasi {{1}}, {{2}}. It was a pleasure. " +
    "If you enjoyed it, a review means a great deal to us: {{3}} " +
    "And here's {{4}} off your next visit — code {{5}}, valid until {{6}}.",
  varanasi_voucher_delivered:
    "Hello {{1}}, {{2}} has sent you a Varanasi gift voucher worth {{3}}. " +
    "Your code is {{4}}, valid until {{5}}. We look forward to welcoming you.",
};
