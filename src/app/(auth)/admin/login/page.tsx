import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * A server component now, so it can read `?reset=1` and confirm what just
 * happened. The form itself is a client component below.
 *
 * The two-panel layout moved to `AuthShell`, shared with the forgotten-password
 * screens. It is also where the stretched logo was fixed: the dark panel is a
 * column flex container, whose children default to `align-items: stretch`,
 * which overrides `width: auto` on an image and pulled a 5:1 mark out past
 * 10:1 while holding its height. One `self-start`, in one place.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;

  return (
    <AuthShell
      kicker="Sign in"
      heading="Welcome back"
      intro="Use the account your manager set up for you."
      aside={
        <p className="mt-6 text-xs text-ink-3 leading-relaxed">
          Forgotten your password? <Link href="/admin/forgot" className="underline hover:text-gold-ink">
            Email yourself a link</Link> — or ask an owner to reset it from Staff access.
        </p>
      }
    >
      {/* Said here rather than left implicit. Someone who has just set a new
          password on another screen needs to know it worked, and that the
          reason they are being asked to sign in is not that something failed. */}
      {reset === "1" && (
        <p role="status" className="mb-6 border-l-2 border-leaf bg-leaf/10 px-4 py-3 text-sm">
          <strong>Your new password is saved.</strong> Sign in with it below. Anyone who was signed
          in to this account elsewhere has been signed out.
        </p>
      )}
      <LoginForm />
    </AuthShell>
  );
}
