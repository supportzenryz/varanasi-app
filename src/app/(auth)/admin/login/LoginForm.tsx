"use client";
import { useActionState } from "react";
import { authField, authLabel, authButton } from "@/components/AuthShell";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <>
      <form action={action}>
        <label className={authLabel} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          className={authField} />

        <label className={`${authLabel} mt-5`} htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className={authField} />

        {state?.error && (
          <p role="alert" className="mt-4 text-sm text-brick bg-clay/10 border-l-2 border-brick px-3 py-2">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className={authButton}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Development only — a member of staff on the live site has an owner to
          ask and should not be reading about terminal commands. It stays
          because the case it covers is real: resetting a password requires
          being signed in, so a forgotten owner password with no working email
          provider locks the back office from the inside. */}
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-3 text-xs text-ink-3/80 leading-relaxed">
          No email set up yet?{" "}
          <code className="text-[0.7rem]">npm run staff:password -- you@example.com --create</code>
        </p>
      )}
    </>
  );
}
