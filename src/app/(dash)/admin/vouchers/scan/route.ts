import { redirect } from "next/navigation";
import { requireAbility } from "@/lib/auth";
import { stashNotice } from "@/lib/flash";
import { voucherByCode, normaliseCode } from "@/lib/voucher";

export const dynamic = "force-dynamic";

/**
 * Where the QR on a printed voucher points.
 *
 * The QR used to link straight to `/admin/vouchers?code=VG-…`, which stopped
 * working when that screen stopped reading the code from the URL — and putting
 * it back would undo the point of the change. This is the middle ground a
 * scanned code needs: the code arrives here in the URL (a QR has nowhere else
 * to put it), is moved into a notice row, and the browser is sent on to a
 * clean `/admin/vouchers?n=…`. What comes to rest in the address bar and in
 * the history of the till's browser is six random bytes.
 *
 * A member of staff scanning this is already signed in, so it opens ready to
 * take an amount off. Anybody else with a camera gets the sign-in page, which
 * is the right answer — and `requireAbility` is what makes that true, not the
 * obscurity of the link.
 */
export async function GET(request: Request) {
  await requireAbility("redeemVoucher");

  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!code.trim()) {
    redirect(`/admin/vouchers?n=${stashNotice({
      kind: "problem",
      message: "That scan carried no voucher code. Type it in instead.",
    })}`);
  }

  const found = voucherByCode(code);
  if (!found) {
    redirect(`/admin/vouchers?n=${stashNotice({
      kind: "problem",
      message: `No voucher found with the code ${normaliseCode(code)}.`,
      context: code,
    })}`);
  }

  redirect(`/admin/vouchers?n=${stashNotice({
    kind: "ok",
    message: `Scanned voucher ${found!.code}.`,
    context: found!.code,
  })}`);
}
