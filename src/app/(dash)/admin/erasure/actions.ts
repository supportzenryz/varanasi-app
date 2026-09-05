"use server";
import { revalidatePath } from "next/cache";
import { requireAbility } from "@/lib/auth";
import { record } from "@/lib/audit";
import { ok, problem } from "@/lib/admin-feedback";
import { erasePersonalData, requestFingerprint } from "@/lib/erasure";

/**
 * Answer one erasure request.
 *
 * The audit entry is the proof the request was answered, and it must not
 * become the place the erased data survives. So it records a fingerprint of
 * what was searched for — enough to match a repeat request or a follow-up
 * complaint to this action — and never the address itself.
 */
export async function eraseAction(formData: FormData) {
  const session = await requireAbility("erasePersonalData");
  const q = String(formData.get("q") ?? "").trim();
  const back = `/admin/erasure?q=${encodeURIComponent(q)}`;

  if (q.length < 3) problem("/admin/erasure", "Enter the email address, phone number or name from the request.");
  if (String(formData.get("confirm") ?? "") !== q) {
    problem(back, "To confirm, type the same email address, phone number or name into the confirmation box.");
  }

  const result = erasePersonalData(q);
  if (!result.ok) problem(back, result.error);

  record(session, {
    action: "gdpr.erase",
    entity: "person",
    entityId: requestFingerprint(q),
    detail: `${result.summary} anonymised (identifier not stored)`,
  });

  revalidatePath("/admin/erasure");
  ok("/admin/erasure", `Done — ${result.summary} anonymised. ` +
    `Reply to the person confirming it, within one month of their request.`);
}
