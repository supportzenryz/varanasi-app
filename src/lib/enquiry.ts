import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { enquiries, branches, privateRooms } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { bookingRules } from "@/lib/booking-config";
import { sendMail } from "@/lib/email";
import { checkName, checkEmail, checkPhone } from "@/lib/validate";

export type Enquiry = typeof enquiries.$inferSelect;
export type EnquiryType = "booking" | "private_room" | "corporate" | "catering" | "contact" | "franchise";

/**
 * Every enquiry the old site sent as an email now lands in the database first,
 * then gets emailed. That's the difference the client asked for: today a lost
 * email is a lost enquiry, with no record anywhere. From here on the record is
 * the database row, and the email is a notification about it.
 */

const TYPE_LABEL: Record<EnquiryType, string> = {
  booking: "Table enquiry",
  private_room: "Private room enquiry",
  corporate: "Corporate event enquiry",
  catering: "Catering enquiry",
  contact: "General enquiry",
  franchise: "Franchise enquiry",
};

export type EnquiryInput = {
  type: EnquiryType;
  branchSlug: string | null;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  partySize?: number | null;
  requestedDate?: string | null;
  requestedTime?: string | null;
  occasion?: string | null;
  roomId?: number | null;
  dietary?: string | null;
  /** franchise: which territory they're asking about — stored in `company`'s sibling field */
  location?: string | null;
  marketingConsent: boolean;
  termsAccepted: boolean;
};

export type EnquiryResult = { ok: true; enquiry: Enquiry } | { ok: false; error: string };

export async function submitEnquiry(input: EnquiryInput): Promise<EnquiryResult> {
  const name = checkName(input.name);
  if (!name.ok) return { ok: false, error: name.error };
  const email = checkEmail(input.email);
  if (!email.ok) return { ok: false, error: email.error };
  // Optional here — an enquiry can be answered by email alone — but if one is
  // given it has to be usable, because a half-typed number is worse than none.
  const phone = checkPhone(input.phone, false);
  if (!phone.ok) return { ok: false, error: phone.error };
  if (!input.termsAccepted) {
    return { ok: false, error: "Please accept the privacy policy so we can respond to you." };
  }
  if (input.message && input.message.length > 4000) {
    return { ok: false, error: "Please keep your message under 4,000 characters." };
  }

  /* Party size, date and time were stored verbatim: 999999 guests, party
   * sizes of 0 and -5, and requested dates of 2020-01-01 and 2099-12-31 all
   * went in and came back a cheerful "your enquiry has reached us". The
   * booking flow validates all of this properly in src/lib/availability.ts;
   * the enquiry forms simply never did. `type=number min=1` and `type=date`
   * are browser hints, and the browser is not where this gets decided. */
  if (input.partySize != null) {
    const n = Number(input.partySize);
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: "Please give the number of guests as a whole number." };
    }
    if (n > 500) {
      return { ok: false, error: "For a party that size, please call us — we'll plan it with you properly." };
    }
  }
  if (input.requestedDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedDate)) {
      return { ok: false, error: "Please give the date as a real date." };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (input.requestedDate < today) {
      return { ok: false, error: "That date has already passed — please choose another." };
    }
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() + 2);
    if (input.requestedDate > horizon.toISOString().slice(0, 10)) {
      return { ok: false, error: "Please choose a date within the next two years." };
    }
  }
  if (input.requestedTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.requestedTime)) {
    return { ok: false, error: "Please give the time as a real time, like 19:30." };
  }

  const branch = input.branchSlug ? branchBySlug(input.branchSlug) : undefined;
  const now = Math.floor(Date.now() / 1000);

  // Franchise enquiries ask for a territory rather than a company; keep both
  // in the fields they belong in and put the territory in the message so it's
  // never lost, whichever screen reads it.
  const message = [
    input.location ? `Franchise location: ${input.location}` : null,
    input.message?.trim() || null,
  ].filter(Boolean).join("\n\n") || null;

  /* A double-click used to create two enquiries, two alerts to the restaurant
   * and two acknowledgements to the sender. The same person sending the same
   * type of enquiry twice inside two minutes is one enquiry. */
  const recent = db.select().from(enquiries).where(and(
    eq(enquiries.email, email.value),
    eq(enquiries.type, input.type),
    gte(enquiries.createdAt, now - 120),
  )).get();
  if (recent) return { ok: true, enquiry: recent };

  const created = db.insert(enquiries).values({
    branchId: branch?.id ?? null,
    type: input.type,
    name: name.value,
    email: email.value,
    phone: phone.value || null,
    company: input.company?.trim() || null,
    partySize: input.partySize ?? null,
    requestedDate: input.requestedDate || null,
    requestedTime: input.requestedTime || null,
    occasion: input.occasion?.trim() || null,
    roomId: input.roomId ?? null,
    dietary: input.dietary?.trim() || null,
    message,
    marketingConsent: input.marketingConsent,
    termsAcceptedAt: now,
    status: "new",
  }).returning().get();

  await notify(created);
  return { ok: true, enquiry: created };
}

function roomName(id: number | null): string | null {
  if (!id) return null;
  return db.select({ name: privateRooms.name }).from(privateRooms)
    .where(eq(privateRooms.id, id)).get()?.name ?? null;
}

async function notify(e: Enquiry): Promise<void> {
  const rules = bookingRules();
  const branch = e.branchId
    ? db.select().from(branches).where(eq(branches.id, e.branchId)).get()
    : undefined;
  const site = (process.env.SITE_URL ?? "https://varanasi.uk").replace(/\/$/, "");
  const label = TYPE_LABEL[e.type as EnquiryType] ?? "Enquiry";

  const detail = [
    `Type:     ${label}`,
    `Name:     ${e.name}`,
    `Email:    ${e.email ?? "—"}`,
    `Phone:    ${e.phone ?? "—"}`,
    branch ? `Branch:   Varanasi ${branch.city}` : "Branch:   not specified",
    e.company ? `Company:  ${e.company}` : null,
    e.partySize ? `Guests:   ${e.partySize}` : null,
    e.requestedDate ? `Date:     ${e.requestedDate}${e.requestedTime ? ` at ${e.requestedTime}` : ""}` : null,
    e.occasion ? `Occasion: ${e.occasion}` : null,
    roomName(e.roomId) ? `Room:     ${roomName(e.roomId)}` : null,
    e.dietary ? `Dietary:  ${e.dietary}` : null,
    `Marketing consent: ${e.marketingConsent ? "yes" : "no"}`,
  ].filter(Boolean).join("\n");

  // to the restaurant
  if (rules.notifications.to.length) {
    await sendMail({
      to: rules.notifications.to,
      subject: `${label}${branch ? ` — ${branch.city}` : ""} — ${e.name}`,
      replyTo: e.email ?? undefined,
      fromName: rules.notifications.fromName,
      fromEmail: rules.notifications.fromEmail,
      text:
`A new enquiry came in through the website.

${detail}
${e.message ? `\nTheir message:\n\n${e.message}\n` : ""}
Reply straight to this email to answer them directly.
See it in the admin: ${site}/admin/enquiries`,
    });
  }

  // acknowledgement to the enquirer, so they know it landed
  if (e.email) {
    await sendMail({
      to: [e.email],
      subject: `We've received your enquiry — Varanasi${branch ? ` ${branch.city}` : ""}`,
      replyTo: rules.notifications.replyTo,
      fromName: rules.notifications.fromName,
      fromEmail: rules.notifications.fromEmail,
      text:
`Dear ${e.name.split(" ")[0]},

Thank you for getting in touch. Your enquiry has reached us and a member of the
team will reply personally — usually within one working day.
${e.message ? `\nFor your records, this is what you sent us:\n\n${e.message}\n` : ""}
If it's urgent, please call us${branch ? ` on ${branch.phone}` : ""} and we'll help straight away.

Kind regards,
Varanasi${branch ? ` ${branch.city}` : " Restaurant"}`,
    });
  }
}

export { TYPE_LABEL };
