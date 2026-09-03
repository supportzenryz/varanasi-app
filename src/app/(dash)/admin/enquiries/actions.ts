"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enquiries, auditLog } from "@/db/schema";
import { requireAbility, assertBranchAccess, type Session } from "@/lib/auth";

function enquiryBranch(id: number): number | null {
  const row = db.select({ branchId: enquiries.branchId }).from(enquiries).where(eq(enquiries.id, id)).get();
  if (!row) throw new Error("Enquiry not found");
  return row.branchId;
}

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity: "enquiry", entityId, detail: detail ?? null,
  }).run();
}

const STATUSES = ["new", "contacted", "confirmed", "closed"] as const;

export async function setEnquiryStatus(formData: FormData) {
  const session = await requireAbility("editEnquiries");
  const id = Number(formData.get("id"));
  const status = String(formData.get("status")) as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) return;

  // A franchise enquiry has no branch; only branch-scoped ones need the check.
  const branchId = enquiryBranch(id);
  if (branchId != null) assertBranchAccess(session, branchId);

  db.update(enquiries).set({
    status,
    // whoever moves it out of "new" owns it
    handledByUserId: status === "new" ? null : session.userId,
  }).where(eq(enquiries.id, id)).run();

  log(session, "enquiry.status", String(id), status);
  revalidatePath("/admin/enquiries");
}

export async function saveEnquiryNote(formData: FormData) {
  const session = await requireAbility("editEnquiries");
  const id = Number(formData.get("id"));
  const branchId = enquiryBranch(id);
  if (branchId != null) assertBranchAccess(session, branchId);

  const note = String(formData.get("internalNote") ?? "").trim();
  db.update(enquiries).set({ internalNote: note || null }).where(eq(enquiries.id, id)).run();
  log(session, "enquiry.note", String(id));
  revalidatePath("/admin/enquiries");
}
