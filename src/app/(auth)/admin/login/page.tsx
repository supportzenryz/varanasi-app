"use client";
import Image from "next/image";
import { useActionState } from "react";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <main className="dash min-h-dvh grid lg:grid-cols-2 bg-pale text-ink">
      <div className="hidden lg:flex flex-col justify-between bg-ink text-pale p-12">
        {/* The full mark — Buddha and wordmark — on the dark panel it was drawn
            for. Copied into public/brand so the admin never depends on the
            media library import having been run. */}
        <Image src="/brand/logo.png" alt="Varanasi" width={520} height={104}
          className="h-14 w-auto" priority />
        <div>
          <h1 className="text-4xl leading-tight max-w-[14ch]">The room behind the restaurant.</h1>
          <p className="mt-4 text-pale/70 max-w-[38ch] text-sm leading-relaxed">
            Menus, private rooms, gift vouchers and enquiries for Birmingham and Leicester — in one place.
          </p>
        </div>
        <span className="text-pale/40 text-xs">Staff access only</span>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <form action={action} className="w-full max-w-sm">
          {/* Narrow screens lose the dark panel, so the form carries the mark
              itself — in the ink variant, since this side is cream. */}
          <Image src="/brand/logo-dark.png" alt="Varanasi" width={520} height={104}
            className="lg:hidden h-11 w-auto mb-8" priority />
          <span className="accent text-xs text-gold-ink">Sign in</span>
          <h2 className="text-3xl mt-3">Welcome back</h2>
          <p className="text-ink-3 text-sm mt-2 mb-8">Use the account your manager set up for you.</p>

          <label className="block text-sm font-medium mb-1.5" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required
            className="w-full rounded-none border border-[--line] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold" />

          <label className="block text-sm font-medium mb-1.5 mt-5" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            className="w-full rounded-none border border-[--line] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold" />

          {state?.error && (
            <p role="alert" className="mt-4 text-sm text-brick bg-clay/10 border-l-2 border-brick px-3 py-2">
              {state.error}
            </p>
          )}

          <button type="submit" disabled={pending}
            className="mt-7 w-full bg-ink text-pale py-3 text-sm font-semibold tracking-wide hover:bg-ink-2 disabled:opacity-60">
            {pending ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-6 text-xs text-ink-3 leading-relaxed">
            Forgotten your password? Ask an owner to reset it from Staff access.
          </p>
        </form>
      </div>
    </main>
  );
}
