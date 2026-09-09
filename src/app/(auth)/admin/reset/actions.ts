"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resetPasswordWithToken } from "@/lib/password-reset";

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Spend the link and set the password.
 *
 * On success this redirects to the sign-in page rather than signing the person
 * in, and that is deliberate. A reset exists partly for the case where someone
 * else had the password: proving you can open the link proves you have the
 * mailbox, and the next thing to establish is that the person now typing knows
 * the new password. It also means the whole flow ends where staff expect to
 * start — at the sign-in screen, with a sentence saying what happened.
 */
export async function resetPasswordAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const result = resetPasswordWithToken(
    token,
    String(formData.get("password") ?? ""),
    String(formData.get("confirm") ?? ""),
    await clientIp(),
  );
  if (!result.ok) return { error: result.error };

  // Outside the try/return above on purpose: redirect() works by throwing, so
  // it must not sit anywhere a catch could swallow it.
  redirect("/admin/login?reset=1");
}
