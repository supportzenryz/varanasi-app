"use client";
import Link from "next/link";
import { useActionState } from "react";
import { AuthShell, authField, authLabel, authButton } from "@/components/AuthShell";
import { requestResetAction } from "./actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestResetAction, undefined);

  if (state?.done) {
    return (
      <AuthShell
        kicker="Forgotten password"
        heading="Check your email"
        intro="If that address has an account here, a link to set a new password is on its way."
      >
        <div className="border-l-2 border-gold bg-gold/10 px-4 py-3 text-sm">
          <p>
            The link works <strong>once</strong>, and only for the next <strong>30 minutes</strong>.
            If it doesn&rsquo;t arrive within a couple of minutes, check the spam folder before
            asking again &mdash; asking again cancels the first link.
          </p>
        </div>
        <p className="mt-6 text-xs text-ink-3 leading-relaxed">
          Nothing has changed on your account yet. Your current password still works until you set
          a new one.
        </p>
        <Link href="/admin/login" className="mt-6 inline-block text-sm underline hover:text-gold-ink">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      kicker="Forgotten password"
      heading="Set a new password"
      intro="Enter the email address you sign in with and we'll send you a link."
    >
      <form action={action}>
        <label className={authLabel} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus
          className={authField} />

        {state?.error && (
          <p role="alert" className="mt-4 text-sm text-brick bg-clay/10 border-l-2 border-brick px-3 py-2">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className={authButton}>
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </form>

      <p className="mt-6 text-xs text-ink-3 leading-relaxed">
        An owner can also reset any account from{" "}
        <span className="whitespace-nowrap">Staff access</span> in the admin.
      </p>
      <Link href="/admin/login" className="mt-4 inline-block text-sm underline hover:text-gold-ink">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
