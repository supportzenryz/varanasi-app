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
        At least 12 characters, with a capital, a small letter and a number. Three or four
        unrelated words are easiest to remember and hardest to guess &mdash;{" "}
        <span className="whitespace-nowrap">copper-Lantern-tuesday7</span> rather than{" "}
        <span className="whitespace-nowrap">Varanasi1!</span>. It can&rsquo;t be the starting
        password, or built out of your own name or email.
      </p>

      <form action={action} className="grid gap-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="current">Current password</label>
          <input id="current" name="current" type="password" required autoComplete="current-password" className={field} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="next">New password</label>
          <input id="next" name="next" type="password" required autoComplete="new-password" minLength={12} className={field} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="confirm">New password again</label>
          <input id="confirm" name="confirm" type="password" required autoComplete="new-password" className={field} />
        </div>

        {/* Only the refusal is rendered here. Success is a redirect to the
            overview carrying its own message, because a form that saves and
            then sits there with three filled-in boxes and a green tick is
            where people stop, unsure whether they are allowed in yet. */}
        {state?.error && <p role="alert" className="text-sm text-brick border-l-2 border-brick bg-clay/10 px-3 py-2">{state.error}</p>}

        <button disabled={pending} className="bg-ink text-pale py-3 text-sm font-semibold disabled:opacity-60">
          {pending ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
