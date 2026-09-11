"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { vouchers, branches } from "@/db/schema";
import { record } from "@/lib/audit";
import { requireAbility, type Session } from "@/lib/auth";
import { parsePounds, formatPence } from "@/lib/money";
import { ok, problem } from "@/lib/admin-feedback";
import {
  redeem, voucherByCode, voucherById, startPurchase, activatePaidVoucher, deliverDueVouchers,
  normaliseCode,
} from "@/lib/voucher";

/* One vocabulary, and no voucher code in the address bar.
 *
 * This screen used to spell the code into the URL so the looked-up voucher
 * stayed on screen after an action: `/admin/vouchers?code=VG-VG2Q-HNUR-KXVC`.
 * That is a working feature and an unnecessary exposure — a voucher code is
 * bearer money, and a URL lands in the browser history of a shared terminal
 * and in every access log between here and the guest. The code now rides in
 * the notice row instead (lib/flash.ts), which the page reads back and puts
 * on screen exactly as before. The URL carries six random bytes. */
const BACK_TO_LIST = "/admin/vouchers";

function log(session: Session, action: string, entityId: string, detail?: string) {
  record(session, { action, entity: "voucher", entityId, detail });
}

/** Take an amount off a voucher at the till. */
export async function redeemVoucher(formData: FormData) {
  const session = await requireAbility("redeemVoucher");
  const code = String(formData.get("code") ?? "");
  const amount = parsePounds(String(formData.get("amount") ?? ""));

  const BACK = BACK_TO_LIST;
  /* The code the till typed in, carried through the redirect so the voucher
     is still on screen afterwards. */
  const KEEP = code;

  if (amount == null) problem(BACK, "Enter the amount as a number, like 25 or 25.50.", KEEP);
  if (amount === 0) problem(BACK, "Enter an amount greater than zero.", KEEP);

  const result = redeem({
    code,
    amountPence: amount!,
    // Staff and managers are pinned to their branch; an owner redeems anywhere.
    branchId: session.branchId,
    anyBranch: session.role === "owner",
    userId: session.userId,
    note: String(formData.get("note") ?? "") || null,
    /* Passed straight through, missing field and all. `redeem` refuses a
       balance it cannot read, which is the correct answer to a request that
       arrived without the one field standing between a double-tap and paying
       out twice — and a much better answer than the old `: null`, which
       quietly meant "skip the check". */
    expectedBalancePence: Number(formData.get("expectedBalance")),
  });

  if (!result.ok) problem(BACK, result.error, KEEP);

  log(session, "voucher.redeem", result.voucher.code,
    `${formatPence(amount!)} taken, ${formatPence(result.remaining)} left`);
  revalidatePath("/admin/vouchers");
  ok(BACK, `${formatPence(amount!)} redeemed. ${result.remaining > 0
    ? `${formatPence(result.remaining)} still on the voucher.`
    : "The voucher is now fully used."}`, KEEP);
}

/** Issue a voucher by hand — a gesture, a complaint, a corporate order. */
export async function issueVoucher(formData: FormData) {
  const session = await requireAbility("issueVoucher");
  const value = parsePounds(String(formData.get("value") ?? ""));
  if (value == null) {
    problem("/admin/vouchers", "Enter the value as a number, like 50 or 50.00.");
  }
  if (value === 0) {
    problem("/admin/vouchers", "Enter a value greater than zero.");
  }

  /* Which restaurant the voucher is good at was taken straight from the form
   * and never checked. A Birmingham manager could therefore mint £500 of
   * Leicester liability — real money owed, against a branch they have no
   * authority over, with no payment behind it. Owners may issue anywhere;
   * everyone else gets their own branch or "either", and nothing else. */
  const requested = String(formData.get("validAt") ?? "") || null;
  let validAt = requested;
  if (session.role !== "owner") {
    /* The gap this closes: the check only ran when a branch WAS named, so a
       manager who left the box empty created a voucher valid at both
       restaurants — liability against the other branch's till, which is the
       exact thing the check exists to prevent, reached by choosing nothing
       instead of choosing wrongly. A non-owner issues for their own restaurant
       and nowhere else. */
    const own = db.select({ slug: branches.slug }).from(branches)
      .where(eq(branches.id, session.branchId ?? -1)).get()?.slug;
    if (!own) {
      problem("/admin/vouchers",
        "This account has no restaurant assigned, so it cannot issue a voucher. Ask the owner.");
    }
    if (requested && requested !== own) {
      problem("/admin/vouchers", "You can only issue vouchers for your own restaurant.");
    }
    validAt = own!;
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
  if (!started.ok) problem("/admin/vouchers", started.error);

  // Issued by staff, so there's no payment to wait for — mark it as manual and
  // activate it straight away.
  db.update(vouchers).set({ origin: "manual" }).where(eq(vouchers.id, started.voucher.id)).run();
  const activated = await activatePaidVoucher({ voucherId: started.voucher.id });

  const issued = voucherById(started.voucher.id)!;
  log(session, "voucher.issue", issued.code, `${formatPence(issued.valuePence)} issued manually`);
  revalidatePath("/admin/vouchers");

  /* Say what actually happened.
   *
   * This reported "issued and emailed to …" whether or not a single message
   * left the building — which is how somebody issues a voucher, tells the
   * guest it is on its way, and finds out days later that it never sent. The
   * voucher itself is real and valid either way; only the email failed, and
   * the difference matters to the person standing at the pass. */
  const sent = activated.delivery?.ok !== false;
  if (sent) {
    ok(BACK_TO_LIST, `Voucher ${issued.code} issued for ${formatPence(issued.valuePence)} and emailed to ${issued.recipientEmail}.`,
      issued.code);
  }
  ok(BACK_TO_LIST, `Voucher ${issued.code} issued for ${formatPence(issued.valuePence)} — but the email to `
    + `${issued.recipientEmail} did NOT send (${activated.delivery?.reason ?? "the provider refused it"}). `
    + "The voucher is valid; read the code out or check Settings → Email. It will retry every hour.",
    issued.code);
}

/** Cancel a voucher — owners only, and it can't be undone. */
export async function cancelVoucher(formData: FormData) {
  const session = await requireAbility("cancelVoucher");
  const code = String(formData.get("code") ?? "");
  const v = voucherByCode(code);
  if (!v) problem("/admin/vouchers", "No voucher found with that code.");

  /* Refuse the second press. The button was a plain form post to an action
     that wrote unconditionally, so a double-click, a browser "resend" or the
     back button re-ran it — each time recording another cancellation of a
     voucher already worth nothing, and each time telling the owner about it.
     The row's own status is the guard: cancelling twice is not a thing that
     can happen. */
  if (v!.status === "cancelled") {
    ok(BACK_TO_LIST, `Voucher ${v!.code} was already cancelled — nothing further has changed.`, v!.code);
  }
  if (v!.status === "redeemed" || v!.balancePence === 0) {
    problem(BACK_TO_LIST, "That voucher has already been used in full — there is nothing left to cancel.");
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
    problem(BACK_TO_LIST, "That voucher changed while you were looking at it — check the balance and try again.");
  }

  log(session, "voucher.cancel", v!.code, `was ${formatPence(was)}`);
  revalidatePath("/admin/vouchers");
  /* The code stays in the URL on the way out. It used to be dropped only on
     this one success path, so the owner cancelled a voucher and the voucher
     vanished from the screen — leaving them to type the code again to check
     that what they had just done had worked. */
  ok(BACK_TO_LIST, `Voucher ${v!.code} cancelled.`, v!.code);
}

/** Send any vouchers whose scheduled delivery date has arrived. */
export async function releaseScheduled() {
  const session = await requireAbility("issueVoucher");
  const n = await deliverDueVouchers();
  log(session, "voucher.release", "scheduled", `${n} delivered`);
  revalidatePath("/admin/vouchers");
  ok("/admin/vouchers",
    n ? `${n} scheduled voucher${n === 1 ? "" : "s"} sent.` : "Nothing was due to be sent.");
}

/**
 * Look a voucher up at the till.
 *
 * A server action rather than the GET form it used to be, for one reason: a
 * GET form puts what you typed into the address bar, and what you type here is
 * a voucher code. The code goes into the notice row instead and comes back on
 * screen from there.
 */
export async function findVoucher(formData: FormData) {
  await requireAbility("redeemVoucher");
  const typed = String(formData.get("code") ?? "").trim();
  if (!typed) problem(BACK_TO_LIST, "Type or scan a voucher code to look it up.");

  const found = voucherByCode(typed);
  if (!found) {
    problem(BACK_TO_LIST, `No voucher found with the code ${normaliseCode(typed)}.`, typed);
  }
  ok(BACK_TO_LIST, `Showing voucher ${found!.code}.`, found!.code);
}
