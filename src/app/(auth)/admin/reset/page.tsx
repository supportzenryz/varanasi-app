import Link from "next/link";
import type { Metadata } from "next";
import { checkResetToken } from "@/lib/password-reset";
import { AuthShell } from "@/components/AuthShell";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The link from the email.
 *
 * A server component, so the token is checked before anything is drawn: an
 * expired or spent link gets an explanation and a way forward instead of a
 * form that will refuse it after the person has chosen a password and typed it
 * twice.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const check = checkResetToken(token);

  if (!check.ok) {
    return (
      <AuthShell kicker="Set a new password" heading="This link can't be used">
        <p role="alert" className="border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm">
          {check.error}
        </p>
        <p className="mt-6 text-sm text-ink-3 leading-relaxed">
          Links last 30 minutes and work once. Asking for a new one also cancels any earlier link,
          so if you requested two, only the most recent email works.
        </p>
        <Link href="/admin/forgot"
          className="mt-7 inline-block w-full bg-ink text-center text-pale py-3 text-sm font-semibold tracking-wide hover:bg-ink-2">
          Send me a new link
        </Link>
        <Link href="/admin/login" className="mt-4 inline-block text-sm underline hover:text-gold-ink">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      kicker="Set a new password"
      heading="Choose a new password"
      intro={<>For <strong>{check.email}</strong>. This also signs that account out everywhere else.</>}
    >
      {/* The token travels in a hidden field rather than being read from the
          URL by the action: the action is a POST and should not depend on what
          the address bar happens to say by the time it runs. */}
      <ResetForm token={token!} />
    </AuthShell>
  );
}
