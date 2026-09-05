"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings, branches } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, branchAllowed, type Session } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";
import { checkDate, checkEmail, checkName, checkPartySize, checkPhone, checkTime, todayInLondon } from "@/lib/validate";
import { sendPostDiningFollowUp } from "@/lib/booking";

function bookingBranch(id: number): number {
  const row = db.select({ branchId: bookings.branchId }).from(bookings).where(eq(bookings.id, id)).get();
  if (!row) throw new Error("Booking not found");
  return row.branchId;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "booking", entityId, detail });
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

  /* The list is filtered by branch and date in the query string, so the
     redirect has to carry them back or a Birmingham manager's "not saved"
     message lands on Leicester's empty list. */
  const slug = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get()?.slug;
  const day = String(formData.get("date") ?? "").trim();
  const back = "/admin/bookings" + (slug ? `?branch=${slug}${/^\d{4}-\d{2}-\d{2}$/.test(day) ? `&date=${day}` : ""}` : "");

  /* Every field checked before anything is written, and every failure
     answered. This whole function used to end its checks with
     `if (!guestName || !date || !time || !partySize) return;` — a silent
     no-op that looked identical to success, and everything that got past it
     went into the table unexamined: partySize -5, date "banana", time
     "99:99", a booking for last March. */
  if (!Number.isInteger(branchId) || branchId <= 0) {
    problem(back, "Choose which restaurant the booking is for.");
  }
  if (!branchAllowed(session, branchId)) {
    problem(back, "You can only add bookings for your own restaurant.");
  }

  const name = checkName(formData.get("guestName") as string);
  if (!name.ok) problem(back, name.error);

  const date = checkDate(formData.get("date") as string);
  if (!date.ok) problem(back, date.error);

  const time = checkTime(formData.get("time") as string);
  if (!time.ok) problem(back, time.error);

  const party = checkPartySize(formData.get("partySize"));
  if (!party.ok) problem(back, party.error);

  /* A date in the past is usually a mistyped year, and it lands where nobody
     will ever look at it. Today is allowed — a walk-in being logged at the
     pass is the most common reason to use this form at all. */
  if (date.value < todayInLondon()) {
    problem(back, `${date.value} has already passed. Check the date — today is ${todayInLondon()}.`);
  }

  /* Contact details are optional here (a walk-in may leave none) but if one is
     given it has to be usable, or the confirmation goes nowhere and the table
     cannot be chased. */
  const emailRaw = clean(formData.get("email"));
  let email: string | null = null;
  if (emailRaw) {
    const e = checkEmail(emailRaw);
    if (!e.ok) problem(back, e.error);
    email = e.value;
  }
  const phoneRaw = clean(formData.get("phone"));
  let phone: string | null = null;
  if (phoneRaw) {
    const ph = checkPhone(phoneRaw, false);
    if (!ph.ok) problem(back, ph.error);
    phone = ph.value;
  }

  if (!slug) problem(back, "That restaurant no longer exists.");

  const created = db.insert(bookings).values({
    reference: reference(slug!),
    branchId,
    guestName: name.value,
    email,
    phone,
    partySize: party.value,
    date: date.value,
    time: time.value,
    occasion: clean(formData.get("occasion")),
    dietary: clean(formData.get("dietary")),
    notes: clean(formData.get("notes")),
    status: "confirmed",
    source: (clean(formData.get("source")) as "phone" | "walk_in" | "website" | "platform" | null) ?? "phone",
  }).returning({ id: bookings.id, reference: bookings.reference }).get();

  log(session, "booking.create", String(created.id),
    `${created.reference} — ${name.value}, ${party.value} on ${date.value} at ${time.value}`);
  revalidatePath("/admin/bookings");
  ok(back, `${name.value}, ${party.value} ${party.value === 1 ? "guest" : "guests"} on ` +
    `${date.value} at ${time.value}. Reference ${created.reference}.`);
}

const STATUSES = ["held", "confirmed", "seated", "completed", "cancelled", "no_show"] as const;

export async function updateBookingStatus(formData: FormData) {
  const session = await requireAbility("editBookings");
  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) problem("/admin/bookings", "That isn’t a status we recognise.");

  const branchId = bookingBranch(id);
  const slug = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get()?.slug;
  const back = "/admin/bookings" + (slug ? `?branch=${slug}` : "");
  if (!branchAllowed(session, branchId)) {
    problem(back, "That booking belongs to the other restaurant.");
  }

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
  ok(back, `Booking marked ${status.replace("_", " ")}.`);
}
