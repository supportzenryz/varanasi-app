import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enquiries, branches, privateRooms } from "@/db/schema";
import { branchBySlug } from "@/lib/branches";
import { bookingRules } from "@/lib/booking-config";
import { sendMail } from "@/lib/email";

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
  if (!input.name?.trim()) return { ok: false, error: "Please tell us your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email ?? "")) {
    return { ok: false, error: "Please give us a valid email address so we can reply." };
  }
  if (!input.termsAccepted) {
    return { ok: false, error: "Please accept the privacy policy so we can respond to you." };
  }
  if (input.message && input.message.length > 4000) {
    return { ok: false, error: "Please keep your message under 4,000 characters." };
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

  const created = db.insert(enquiries).values({
    branchId: branch?.id ?? null,
    type: input.type,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || null,
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
