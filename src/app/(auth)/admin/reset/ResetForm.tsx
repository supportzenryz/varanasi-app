"use client";
import { useActionState } from "react";
import { authField, authLabel, authButton } from "@/components/AuthShell";
import { resetPasswordAction } from "./actions";

/** Split out because the page around it is a server component: the token has
 *  to be checked before the form is drawn, and only this part needs state. */
export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className={authLabel} htmlFor="password">New password</label>
        <input id="password" name="password" type="password" required autoFocus
          autoComplete="new-password" minLength={12} className={authField} />
        <p className="mt-2 text-xs text-ink-3 leading-relaxed">
          At least 12 characters, with a capital, a small letter and a number. Three or four
          unrelated words are easiest to remember and hardest to guess.
        </p>
      </div>

      <div>
        <label className={authLabel} htmlFor="confirm">New password again</label>
        <input id="confirm" name="confirm" type="password" required
          autoComplete="new-password" className={authField} />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-brick bg-clay/10 border-l-2 border-brick px-3 py-2">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Saving…" : "Save and sign in"}
      </button>
    </form>
  );
}
