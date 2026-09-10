"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility } from "@/lib/auth";
import { ok, problem } from "@/lib/admin-feedback";
import { campaignById, weekOf } from "@/lib/marketing";
import { composeDraft, sendCampaign } from "@/lib/campaign";

const BACK = "/admin/marketing";

const nowSec = () => Math.floor(Date.now() / 1000);

/** Save the owner's edits to a draft. */
export async function saveDraft(formData: FormData) {
  const session = await requireAbility("editMarketing");
  const id = Number(formData.get("id"));
  const c = campaignById(id);
  if (!c) problem(BACK, "That draft no longer exists.");
  if (c!.status !== "draft") {
    problem(BACK, `That one has already been ${c!.status} — it can't be edited now.`);
  }

  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (subject.length < 3) problem(BACK, "Give the email a subject line — it's the only thing most people read.");
  if (body.length < 40) problem(BACK, "The message is too short to send. Say what's on this week.");

  const branchRaw = String(formData.get("branchId") ?? "");
  const branchId = branchRaw ? Number(branchRaw) : null;
  if (branchRaw && !Number.isInteger(branchId)) problem(BACK, "Choose a restaurant, or both.");

  db.update(campaigns).set({
    subject,
    body,
    preheader: String(formData.get("preheader") ?? "").trim() || null,
    branchId,
    updatedAt: nowSec(),
  }).where(eq(campaigns.id, id)).run();

  record(session, {
    action: "marketing.edit", entity: "campaign", entityId: String(id),
    detail: `subject "${subject}"`,
  });
  revalidatePath(BACK);
  ok(BACK, "Draft saved. Nothing has been sent yet.");
}

/** Write a fresh draft for this week, or replace the one that is there. */
export async function regenerateDraft() {
  const session = await requireAbility("editMarketing");
  const week = weekOf();
  const existing = db.select().from(campaigns).where(eq(campaigns.weekOf, week)).get();

  if (existing && existing.status !== "draft") {
    problem(BACK, "This week's email has already gone out. Nothing is written over a sent campaign.");
  }

  const { subject, preheader, body } = composeDraft();
  if (existing) {
    db.update(campaigns).set({ subject, preheader, body, updatedAt: nowSec() })
      .where(eq(campaigns.id, existing.id)).run();
  } else {
    db.insert(campaigns).values({
      subject, preheader, body, status: "draft", weekOf: week, preparedBy: session.name,
    }).run();
  }

  record(session, { action: "marketing.draft", entity: "campaign", entityId: week,
    detail: "draft rewritten from this week's content" });
  revalidatePath(BACK);
  ok(BACK, "A new draft is ready. Read it before you send it — your edits were replaced.");
}

/** Discard a draft without sending it. */
export async function cancelDraft(formData: FormData) {
  const session = await requireAbility("editMarketing");
  const id = Number(formData.get("id"));
  const c = campaignById(id);
  if (!c) problem(BACK, "That draft no longer exists.");
  if (c!.status !== "draft") problem(BACK, "Only a draft can be discarded.");

  db.update(campaigns).set({ status: "cancelled", updatedAt: nowSec() })
    .where(eq(campaigns.id, id)).run();
  record(session, { action: "marketing.cancel", entity: "campaign", entityId: String(id) });
  revalidatePath(BACK);
  ok(BACK, "Draft discarded. Nothing was sent.");
}

/**
 * Send it. Owners only, and there is no undo.
 *
 * `sendCampaign` claims the row conditionally before the first message goes
 * out, so a double-click or a browser resend cannot mail the list twice.
 */
export async function send(formData: FormData) {
  const session = await requireAbility("sendMarketing");
  const id = Number(formData.get("id"));

  const result = await sendCampaign(id, session.userId);
  if (!result.ok) problem(BACK, result.error ?? "The send did not start.");

  record(session, {
    action: "marketing.send", entity: "campaign", entityId: String(id),
    detail: `${result.sent} sent${result.failed ? `, ${result.failed} refused` : ""}`,
  });
  revalidatePath(BACK);
  ok(BACK, result.failed
    ? `Sent to ${result.sent} people. ${result.failed} were refused by the mail provider — check the activity log.`
    : `Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}.`);
}
