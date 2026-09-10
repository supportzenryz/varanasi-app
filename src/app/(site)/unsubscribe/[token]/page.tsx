import type { Metadata } from "next";
import Link from "next/link";
import { unsubscribeByToken } from "@/lib/marketing";

/**
 * One press, and it is done.
 *
 * No sign-in, no "are you sure", no survey asking why, no form to fill in.
 * Opening the link unsubscribes; the page is the confirmation. Anything more
 * is friction between somebody who wants to leave and leaving, and under PECR
 * the obligation is to make opting out simple and free — a page that asks
 * them to confirm their address first does not meet that, and in practice it
 * converts a quiet unsubscribe into a spam complaint, which costs the
 * restaurant far more than one address.
 *
 * Pressing it twice says the same thing rather than reporting an error: the
 * second press is nearly always somebody checking it worked.
 */
export const metadata: Metadata = {
  title: "Unsubscribed",
  robots: { index: false, follow: false },
};

export default async function Unsubscribe({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = unsubscribeByToken(token);

  return (
    <main className="min-h-dvh grid place-items-center px-5 py-24">
      <div className="max-w-xl text-center">
        <p className="accent text-gold mb-5">Varanasi</p>

        {result.ok ? (
          <>
            <h1 className="text-3xl sm:text-4xl mb-5">You&rsquo;re unsubscribed</h1>
            <p className="text-pale/70 leading-relaxed">
              {result.email ? (
                <>We won&rsquo;t send <span className="text-pale">{result.email}</span> any more
                  news or offers. </>
              ) : (
                <>We won&rsquo;t send you any more news or offers. </>
              )}
              Booking confirmations and gift voucher emails still come through — those
              aren&rsquo;t marketing, and you&rsquo;d want them.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl sm:text-4xl mb-5">That link has expired</h1>
            <p className="text-pale/70 leading-relaxed">
              We couldn&rsquo;t match it to anyone on our list, which usually means
              you&rsquo;ve already unsubscribed. If you keep hearing from us, reply to any
              of our emails and a person will sort it out.
            </p>
          </>
        )}

        <Link href="/" className="btn btn-ink mt-9 inline-block">
          Back to Varanasi
        </Link>
      </div>
    </main>
  );
}
