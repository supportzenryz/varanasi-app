"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enquiries } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";

const BACK = "/admin/enquiries";

function enquiryBranch(id: number): number | null | undefined {
  const row = db.select({ branchId: enquiries.branchId }).from(enquiries).where(eq(enquiries.id, id)).get();
  return row ? row.branchId : undefined;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "enquiry", entityId, detail });
}

const STATUSES = ["new", "contacted", "confirmed", "closed"] as const;

export async function setEnquiryStatus(formData: FormData) {
  const session = await requireAbility("editEnquiries");
  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) problem(BACK, "That isn't a status we recognise.");

  const branchId = enquiryBranch(id);
  if (branchId === undefined) problem(BACK, "That enquiry no longer exists.");

  /* A franchise enquiry carries no branch, so it belongs to the group. Only an
     owner sees those; a manager reaching one has followed a stale link. */
  if (branchId == null) {
    if (session.role !== "owner") problem(BACK, "Head-office enquiries are for owners only.");
  } else {
    assertBranchAccess(session, branchId);
  }

  db.update(enquiries).set({
    status,
    // whoever moves it out of "new" owns it
    handledByUserId: status === "new" ? null : session.userId,
  }).where(eq(enquiries.id, id)).run();

  log(session, "enquiry.status", String(id), status);
  revalidatePath(BACK);
  ok(BACK, status === "new"
    ? "Put back in the new list."
    : `Marked ${status}${status === "closed" ? "" : " — it's yours now"}.`);
}

export async function saveEnquiryNote(formData: FormData) {
  const session = await requireAbility("editEnquiries");
  const id = Number(formData.get("id"));
  const branchId = enquiryBranch(id);
  if (branchId === undefined) problem(BACK, "That enquiry no longer exists.");
  if (branchId == null) {
    if (session.role !== "owner") problem(BACK, "Head-office enquiries are for owners only.");
  } else {
    assertBranchAccess(session, branchId);
  }

  const note = String(formData.get("internalNote") ?? "").trim();
  db.update(enquiries).set({ internalNote: note || null }).where(eq(enquiries.id, id)).run();
  log(session, "enquiry.note", String(id));
  revalidatePath(BACK);
  ok(BACK, note ? "Note saved." : "Note cleared.");
}
