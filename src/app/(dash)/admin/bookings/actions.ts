"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, branches, auditLog } from "@/db/schema";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { sendPostDiningFollowUp } from "@/lib/booking";

function bookingBranch(id: number): number {
  const row = db.select({ branchId: bookings.branchId }).from(bookings).where(eq(bookings.id, id)).get();
  if (!row) throw new Error("Booking not found");
  return row.branchId;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity: "booking", entityId, detail: detail ?? null,
  }).run();
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** "VB-260903-4F2K" — branch initial, date, four random base36 chars. Not
 *  meant to be unguessable (bookings aren't redeemed like vouchers), just
 *  short and readable over the phone. */
function reference(branchSlug: string): string {
  const initial = branchSlug === "leicester" ? "VL" : "VB";
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${initial}-${stamp}-${rand}`;
}

export async function addBooking(formData: FormData) {
  const session = await requireAbility("editBookings");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);

  const guestName = clean(formData.get("guestName"));
  const date = clean(formData.get("date"));
  const time = clean(formData.get("time"));
  const partySize = Number(formData.get("partySize"));
  if (!guestName || !date || !time || !partySize) return;

  const branch = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get();
  const created = db.insert(bookings).values({
    reference: reference(branch?.slug ?? "vb"),
    branchId,
    guestName,
    email: clean(formData.get("email")),
    phone: clean(formData.get("phone")),
    partySize,
    date,
    time,
    occasion: clean(formData.get("occasion")),
    dietary: clean(formData.get("dietary")),
    notes: clean(formData.get("notes")),
    status: "confirmed",
    source: (clean(formData.get("source")) as "phone" | "walk_in" | "website" | "platform" | null) ?? "phone",
  }).returning({ id: bookings.id, reference: bookings.reference }).get();

  log(session, "booking.create", String(created.id), `${created.reference} — ${guestName}`);
  revalidatePath("/admin/bookings");
}

const STATUSES = ["held", "confirmed", "seated", "completed", "cancelled", "no_show"] as const;

export async function updateBookingStatus(formData: FormData) {
  const session = await requireAbility("editBookings");
  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) return;

  const branchId = bookingBranch(id);
  assertBranchAccess(session, branchId);

  db.update(bookings).set({ status }).where(eq(bookings.id, id)).run();
  log(session, "booking.status", String(id), status);

  // Marking a booking `completed` is what triggers the after-dining message:
  // the Google review link and the complimentary voucher. It's idempotent, so
  // re-marking the same booking won't send twice or mint a second voucher.
  if (status === "completed") {
    const result = await sendPostDiningFollowUp(id);
    if (result.sent) log(session, "booking.followup", String(id), "thank-you sent");
  }

  revalidatePath("/admin/bookings");
}
