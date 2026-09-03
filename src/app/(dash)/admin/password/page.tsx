"use client";
import { useActionState } from "react";
import { changePasswordAction } from "../actions";

export default function PasswordPage() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  const field = "w-full border border-[--line] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold";

  return (
    <div className="max-w-sm">
      <span className="accent text-xs text-gold-ink">Your account</span>
      <h1 className="text-3xl mt-3">Change your password</h1>
      <p className="text-ink-3 text-sm mt-2 mb-8">
        Pick something only you know, at least 10 characters.
      </p>

      <form action={action} className="grid gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="current">Current password</label>
          <input id="current" name="current" type="password" required autoComplete="current-password" className={field} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="next">New password</label>
          <input id="next" name="next" type="password" required autoComplete="new-password" minLength={10} className={field} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="confirm">New password again</label>
          <input id="confirm" name="confirm" type="password" required autoComplete="new-password" className={field} />
        </div>

        {state?.error && <p role="alert" className="text-sm text-brick border-l-2 border-brick bg-clay/10 px-3 py-2">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-leaf border-l-2 border-leaf bg-leaf/10 px-3 py-2">Saved. Your new password is active.</p>}

        <button disabled={pending} className="bg-ink text-pale py-3 text-sm font-semibold disabled:opacity-60">
          {pending ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
