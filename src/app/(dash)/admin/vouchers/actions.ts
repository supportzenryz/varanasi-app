"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { vouchers } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, type Session } from "@/lib/auth";
import { branchBySlug } from "@/lib/branches";
import { parsePounds, formatPence } from "@/lib/money";
import {
  redeem, voucherByCode, voucherById, startPurchase, activatePaidVoucher, deliverDueVouchers,
} from "@/lib/voucher";

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "voucher", entityId, detail });
}

/** Take an amount off a voucher at the till. */
export async function redeemVoucher(formData: FormData) {
  const session = await requireAbility("redeemVoucher");
  const code = String(formData.get("code") ?? "");
  const amount = parsePounds(String(formData.get("amount") ?? ""));

  const back = (msg: string, ok = false) =>
    `/admin/vouchers?code=${encodeURIComponent(code)}&${ok ? "done" : "error"}=${encodeURIComponent(msg)}`;

  if (amount == null) {
    redirectTo(back("Enter the amount as a number, like 25 or 25.50."));
  }
  if (amount === 0) redirectTo(back("Enter an amount greater than zero."));

  const result = redeem({
    code,
    amountPence: amount!,
    // Staff and managers are pinned to their branch; an owner redeems anywhere.
    branchId: session.role === "owner" ? null : session.branchId,
    userId: session.userId,
    note: String(formData.get("note") ?? "") || null,
    expectedBalancePence: formData.get("expectedBalance") != null
      ? Number(formData.get("expectedBalance"))
      : null,
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
  if (value == null) {
    redirectTo(`/admin/vouchers?error=${encodeURIComponent("Enter the value as a number, like 50 or 50.00.")}`);
  }
  if (value === 0) {
    redirectTo(`/admin/vouchers?error=${encodeURIComponent("Enter a value greater than zero.")}`);
  }

  /* Which restaurant the voucher is good at was taken straight from the form
   * and never checked. A Birmingham manager could therefore mint £500 of
   * Leicester liability — real money owed, against a branch they have no
   * authority over, with no payment behind it. Owners may issue anywhere;
   * everyone else gets their own branch or "either", and nothing else. */
  const requested = String(formData.get("validAt") ?? "") || null;
  let validAt = requested;
  if (session.role !== "owner" && requested) {
    const target = branchBySlug(requested);
    if (!target || target.id !== session.branchId) {
      redirectTo(`/admin/vouchers?error=${encodeURIComponent(
        "You can only issue vouchers for your own restaurant, or ones valid at either.")}`);
    }
    validAt = requested;
  }

  const started = startPurchase({
    branchSlug: validAt,
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

  /* Refuse the second press. The button was a plain form post to an action
     that wrote unconditionally, so a double-click, a browser "resend" or the
     back button re-ran it — each time recording another cancellation of a
     voucher already worth nothing, and each time telling the owner about it.
     The row's own status is the guard: cancelling twice is not a thing that
     can happen. */
  if (v!.status === "cancelled") {
    redirectTo(`/admin/vouchers?code=${encodeURIComponent(v!.code)}&done=${encodeURIComponent(
      `Voucher ${v!.code} was already cancelled — nothing further has changed.`)}`);
  }
  if (v!.status === "redeemed" || v!.balancePence === 0) {
    redirectTo(`/admin/vouchers?code=${encodeURIComponent(v!.code)}&error=${encodeURIComponent(
      "That voucher has already been used in full — there is nothing left to cancel.")}`);
  }

  const was = v!.balancePence;
  db.update(vouchers)
    .set({ status: "cancelled", balancePence: 0 })
    // Optimistic: if another till spent from it between the read above and
    // this write, the balance no longer matches and nothing is written.
    .where(and(eq(vouchers.id, v!.id), eq(vouchers.balancePence, was)))
    .run();

  const after = voucherById(v!.id);
  if (after?.status !== "cancelled") {
    redirectTo(`/admin/vouchers?code=${encodeURIComponent(v!.code)}&error=${encodeURIComponent(
      "That voucher changed while you were looking at it — check the balance and try again.")}`);
  }

  log(session, "voucher.cancel", v!.code, `was ${formatPence(was)}`);
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
