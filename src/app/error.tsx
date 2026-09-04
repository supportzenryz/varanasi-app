"use client";
import Link from "next/link";

/**
 * The last resort, for an unhandled exception anywhere in the app.
 *
 * Next's default is a stack trace in development and a blank page in
 * production. Neither is acceptable to show a guest, and the blank one is
 * worse: it gives no indication whether their booking went through.
 *
 * This says the one thing they need — whether their money is at stake — and
 * offers a phone number, because at this point the site has already failed
 * them and a person is the honest next step. It cannot import server code, so
 * the number is passed no further than the copy here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="on-dark bg-ink text-pale min-h-dvh flex items-center justify-center px-5 py-20">
      <div className="w-full max-w-[42rem] text-center">
        <p className="accent text-[0.62rem] text-gold">Something went wrong</p>
        <h1 className="display text-[1.9rem] sm:text-[2.4rem] leading-tight mt-4 text-balance">
          We&rsquo;re sorry — that didn&rsquo;t work
        </h1>
        <p className="text-pale/70 mt-5 leading-relaxed max-w-[48ch] mx-auto">
          Something on our side failed. If you were part-way through a booking, nothing has
          been charged and no table has been held — please try again, or call the restaurant
          and we&rsquo;ll take care of it.
        </p>

        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <button onClick={reset} className="btn btn-gold">Try again</button>
          <Link href="/" className="btn btn-outline">Back to Varanasi</Link>
        </div>

        {/* Useful to quote on the phone, and meaningless to anyone else. */}
        {error.digest && (
          <p className="text-xs text-pale/40 mt-10 tnum">Reference {error.digest}</p>
        )}
      </div>
    </main>
  );
}
