"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blockedDates, auditLog } from "@/db/schema";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";

function blockBranch(id: number): number {
  const row = db.select({ branchId: blockedDates.branchId }).from(blockedDates).where(eq(blockedDates.id, id)).get();
  if (!row) throw new Error("Blocked date not found");
  return row.branchId;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity: "blocked_date", entityId, detail: detail ?? null,
  }).run();
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function addBlockedDate(formData: FormData) {
  const session = await requireAbility("editBlockedDates");
  const branchId = Number(formData.get("branchId"));
  assertBranchAccess(session, branchId);

  const date = clean(formData.get("date"));
  if (!date) return;

  const allDay = formData.get("allDay") === "on";
  const roomId = clean(formData.get("roomId"));

  const created = db.insert(blockedDates).values({
    branchId,
    date,
    allDay,
    fromTime: allDay ? null : clean(formData.get("fromTime")),
    toTime: allDay ? null : clean(formData.get("toTime")),
    roomId: roomId ? Number(roomId) : null,
    reason: clean(formData.get("reason")),
  }).returning({ id: blockedDates.id }).get();

  log(session, "blocked_date.create", String(created.id), date);
  revalidatePath("/admin/dates");
}

export async function deleteBlockedDate(formData: FormData) {
  const session = await requireAbility("editBlockedDates");
  const id = Number(formData.get("id"));
  const branchId = blockBranch(id);
  assertBranchAccess(session, branchId);

  db.delete(blockedDates).where(eq(blockedDates.id, id)).run();
  log(session, "blocked_date.delete", String(id));
  revalidatePath("/admin/dates");
}
