"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vouchers, auditLog } from "@/db/schema";
import { requireAbility, type Session } from "@/lib/auth";
import { parsePounds, formatPence } from "@/lib/money";
import {
  redeem, voucherByCode, voucherById, startPurchase, activatePaidVoucher, deliverDueVouchers,
} from "@/lib/voucher";

function log(session: Session, action: string, entityId: string, detail?: string) {
  db.insert(auditLog).values({
    userId: session.userId, action, entity: "voucher", entityId, detail: detail ?? null,
  }).run();
}

/** Take an amount off a voucher at the till. */
export async function redeemVoucher(formData: FormData) {
  const session = await requireAbility("redeemVoucher");
  const code = String(formData.get("code") ?? "");
  const amount = parsePounds(String(formData.get("amount") ?? ""));

  const back = (msg: string, ok = false) =>
    `/admin/vouchers?code=${encodeURIComponent(code)}&${ok ? "done" : "error"}=${encodeURIComponent(msg)}`;

  if (!amount) redirectTo(back("Enter the amount to take off the voucher."));

  const result = redeem({
    code,
    amountPence: amount!,
    // Staff and managers are pinned to their branch; an owner redeems anywhere.
    branchId: session.role === "owner" ? null : session.branchId,
    userId: session.userId,
    note: String(formData.get("note") ?? "") || null,
  });

  if (!result.ok) redirectTo(back(result.error));

  log(session, "voucher.redeem", result.voucher.code,
    `${formatPence(amount!)} taken, ${formatPence(result.remaining)} left`);
  revalidatePath("/admin/vouchers");
  redirectTo(back(
    `${formatPence(amount!)} redeemed. ${result.remaining > 0
      ? `${formatPence(result.remaining)} still on the voucher.`
      : "The voucher is now fully used."}`, true));
}

/** Issue a voucher by hand — a gesture, a complaint, a corporate order. */
export async function issueVoucher(formData: FormData) {
  const session = await requireAbility("issueVoucher");
  const value = parsePounds(String(formData.get("value") ?? ""));
  if (!value) redirectTo(`/admin/vouchers?error=${encodeURIComponent("Enter a value for the voucher.")}`);

  const started = startPurchase({
    branchSlug: String(formData.get("validAt") ?? "") || null,
    valuePence: value!,
    purchaserName: session.name,
    purchaserEmail: session.email,
    recipientName: String(formData.get("toName") ?? ""),
    recipientEmail: String(formData.get("toEmail") ?? ""),
    message: String(formData.get("message") ?? "") || null,
    deliverOn: null,
  });
  if (!started.ok) redirectTo(`/admin/vouchers?error=${encodeURIComponent(started.error)}`);

  // Issued by staff, so there's no payment to wait for — mark it as manual and
  // activate it straight away.
  db.update(vouchers).set({ origin: "manual" }).where(eq(vouchers.id, started.voucher.id)).run();
  await activatePaidVoucher({ voucherId: started.voucher.id });

  const issued = voucherById(started.voucher.id)!;
  log(session, "voucher.issue", issued.code, `${formatPence(issued.valuePence)} issued manually`);
  revalidatePath("/admin/vouchers");
  redirectTo(`/admin/vouchers?code=${encodeURIComponent(issued.code)}&done=${encodeURIComponent(
    `Voucher ${issued.code} issued for ${formatPence(issued.valuePence)} and emailed to ${issued.recipientEmail}.`)}`);
}

/** Cancel a voucher — owners only, and it can't be undone. */
export async function cancelVoucher(formData: FormData) {
  const session = await requireAbility("cancelVoucher");
  const code = String(formData.get("code") ?? "");
  const v = voucherByCode(code);
  if (!v) redirectTo(`/admin/vouchers?error=${encodeURIComponent("No voucher found with that code.")}`);

  db.update(vouchers).set({ status: "cancelled", balancePence: 0 }).where(eq(vouchers.id, v!.id)).run();
  log(session, "voucher.cancel", v!.code, `was ${formatPence(v!.balancePence)}`);
  revalidatePath("/admin/vouchers");
  redirectTo(`/admin/vouchers?done=${encodeURIComponent(`Voucher ${v!.code} cancelled.`)}`);
}

/** Send any vouchers whose scheduled delivery date has arrived. */
export async function releaseScheduled() {
  const session = await requireAbility("issueVoucher");
  const n = await deliverDueVouchers();
  log(session, "voucher.release", "scheduled", `${n} delivered`);
  revalidatePath("/admin/vouchers");
  redirectTo(`/admin/vouchers?done=${encodeURIComponent(
    n ? `${n} scheduled voucher${n === 1 ? "" : "s"} sent.` : "Nothing was due to be sent.")}`);
}

/* `redirect` throws, which TypeScript can't see through a helper unless we
   tell it the helper never returns. */
import { redirect } from "next/navigation";
function redirectTo(url: string): never {
  redirect(url);
}
