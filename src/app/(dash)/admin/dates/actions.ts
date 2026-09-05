"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { blockedDates, branches, privateRooms } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, branchAllowed, type Session } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";
import { checkDate, checkTime, todayInLondon } from "@/lib/validate";

function blockBranch(id: number): number | null {
  const row = db.select({ branchId: blockedDates.branchId }).from(blockedDates).where(eq(blockedDates.id, id)).get();
  return row?.branchId ?? null;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "blocked_date", entityId, detail });
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

function backTo(branchId: number): string {
  const slug = db.select({ slug: branches.slug }).from(branches).where(eq(branches.id, branchId)).get()?.slug;
  return "/admin/dates" + (slug ? `?branch=${slug}` : "");
}

/**
 * Close a branch, or one room, for a day or part of one.
 *
 * The old version wrote whatever it was given. Four ways that produced a
 * closure which closed nothing, each of them silent, and each discovered only
 * when a guest booked a table for a night the restaurant was shut:
 *
 *   date "31/12/2026"  — stored as typed, never equal to a "2026-12-31" the
 *                        availability check compares against
 *   part-day with no times — allDay false, fromTime and toTime both null, so
 *                        the window it blocks is empty
 *   to before from     — 22:00 to 02:00 reads as an overnight closure and
 *                        matches no slot at all
 *   a room from the other branch — a Birmingham manager closing a Leicester
 *                        room, taking a private dining room off sale at a
 *                        restaurant they have no authority over
 */
export async function addBlockedDate(formData: FormData) {
  const session = await requireAbility("editBlockedDates");
  const branchId = Number(formData.get("branchId"));
  const back = backTo(branchId);

  if (!Number.isInteger(branchId) || branchId <= 0) problem("/admin/dates", "Choose a restaurant.");
  if (!branchAllowed(session, branchId)) {
    problem("/admin/dates", "You can only close dates at your own restaurant.");
  }

  const date = checkDate(formData.get("date") as string);
  if (!date.ok) problem(back, date.error);
  if (date.value < todayInLondon()) {
    problem(back, `${date.value} has already passed — closing it changes nothing.`);
  }

  const allDay = formData.get("allDay") === "on";
  let fromTime: string | null = null;
  let toTime: string | null = null;

  if (!allDay) {
    const f = checkTime(formData.get("fromTime") as string);
    const t = checkTime(formData.get("toTime") as string);
    if (!f.ok) problem(back, `Start time: ${f.error} Or tick "all day".`);
    if (!t.ok) problem(back, `End time: ${t.error} Or tick "all day".`);
    if (t.value <= f.value) {
      problem(back, `The end time has to be after the start. ${f.value} to ${t.value} closes nothing.`);
    }
    fromTime = f.value;
    toTime = t.value;
  }

  const roomRaw = clean(formData.get("roomId"));
  let roomId: number | null = null;
  if (roomRaw) {
    const n = Number(roomRaw);
    if (!Number.isInteger(n) || n <= 0) problem(back, "That isn't a room we recognise.");
    const room = db.select({ id: privateRooms.id, name: privateRooms.name })
      .from(privateRooms).where(and(eq(privateRooms.id, n), eq(privateRooms.branchId, branchId))).get();
    if (!room) problem(back, "That room belongs to the other restaurant.");
    roomId = room!.id;
  }

  /* The same closure twice is not an error worth refusing over, but it is
     worth saying, because the second one looks like it did nothing. */
  const dupe = db.select({ id: blockedDates.id }).from(blockedDates)
    .where(and(
      eq(blockedDates.branchId, branchId),
      eq(blockedDates.date, date.value),
      eq(blockedDates.allDay, allDay),
    )).all()
    .length;

  const created = db.insert(blockedDates).values({
    branchId, date: date.value, allDay, fromTime, toTime, roomId,
    reason: clean(formData.get("reason")),
  }).returning({ id: blockedDates.id }).get();

  const what = allDay ? "all day" : `${fromTime}–${toTime}`;
  log(session, "blocked_date.create", String(created.id), `${date.value} ${what}${roomId ? ` (room ${roomId})` : ""}`);
  revalidatePath("/admin/dates");
  ok(back, `${date.value} closed ${what}.${dupe ? " There was already a closure on that date." : ""}`);
}

export async function deleteBlockedDate(formData: FormData) {
  const session = await requireAbility("editBlockedDates");
  const id = Number(formData.get("id"));
  const branchId = blockBranch(id);
  if (branchId == null) problem("/admin/dates", "That closure has already been removed.");
  if (!branchAllowed(session, branchId!)) {
    problem("/admin/dates", "That closure belongs to the other restaurant.");
  }

  db.delete(blockedDates).where(eq(blockedDates.id, id)).run();
  log(session, "blocked_date.delete", String(id));
  revalidatePath("/admin/dates");
  ok(backTo(branchId!), "Closure removed — that date is bookable again.");
}
