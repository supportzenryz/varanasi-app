import Link from "next/link";
import "../globals.css";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { stripeConfigured } from "@/lib/stripe";
import { formatPence } from "@/lib/money";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Stands in for Stripe's hosted payment page until real keys are in place.
 *
 * The real integration is already written — `createDepositCheckout` and
 * `createVoucherCheckout` in lib/stripe, confirmed by the signed webhook at
 * /api/stripe/webhook. Set STRIPE_SECRET_KEY and this route returns 404, the
 * live Stripe Checkout takes over, and nothing else in the app changes.
 *
 * It never asks for card details, because it isn't a payment page. It is the
 * order summary a guest sees before paying, plus the two outcomes — paid and
 * not paid — so the whole journey, failure path included, can be walked today.
 *
 * Everything here is a link or a form. There is no client-side state, so no
 * "use client": an earlier revision put onClick handlers on these buttons and
 * the route 500'd on every request.
 */

type Search = { ref?: string; amount?: string; success?: string; cancel?: string };

/** Both callers build the cancel URL as `<site>/<branch>/<flow>/unconfirmed?…`,
 *  so it carries everything needed to offer a way back: which branch the guest
 *  is buying from, and which form to return them to if they want to change the
 *  order. Parsed defensively — a malformed URL must not take the page down. */
function routeBack(cancel: string): { home: string; edit: string; label: string } {
  const fallback = { home: "/", edit: "/", label: "the form" };
  try {
    const path = cancel.startsWith("/") ? cancel : new URL(cancel).pathname;
    const [, branch, flow] = path.split("/");
    if (!branch) return fallback;
    const home = `/${branch}`;
    if (flow === "gift-vouchers") return { home, edit: `${home}/gift-vouchers`, label: "gift voucher" };
    if (flow === "book-online") return { home, edit: `${home}/book-online`, label: "reservation" };
    return { home, edit: home, label: "order" };
  } catch {
    return fallback;
  }
}

export default async function CheckoutSimulator({ searchParams }: { searchParams: Promise<Search> }) {
  // With real Stripe configured, this must not be reachable.
  if (stripeConfigured()) notFound();

  const { ref, amount, success, cancel } = await searchParams;
  if (!ref || !success || !cancel) notFound();

  // Only ever bounce back into this site or an absolute URL we generated.
  const safe = (url: string) => (url.startsWith("/") || url.includes("://") ? url : "/");
  const pence = Number(amount ?? 0);
  const isVoucher = ref.startsWith("VG-");
  const back = routeBack(cancel);

  const lineItem = isVoucher
    ? { name: "Varanasi gift voucher", note: `Voucher ${ref}`, terms: "Vouchers are valid for 12 months from purchase." }
    : { name: "Table deposit", note: `Booking ${ref}`, terms: "The deposit comes off your final bill." };

  return (
    <main className="on-dark min-h-dvh bg-ink text-pale">
      {/* A checkout keeps its own minimal header: the brand, and one way out.
          Guests who feel trapped on a payment page abandon it. */}
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-[60rem] px-5 sm:px-8 h-20 flex items-center justify-between gap-4">
          <Link href={back.home} className="display text-lg sm:text-xl text-pale hover:text-gold">
            Varanasi
          </Link>
          <Link href={back.home} className="text-sm text-pale/70 hover:text-gold">
            ← Back to the restaurant
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[60rem] px-5 sm:px-8 py-10 sm:py-14">
        <p className="accent text-gold">Secure checkout</p>
        <h1 className="text-3xl sm:text-[2.5rem] mt-3 leading-tight">Review and pay</h1>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          {/* ---------- order summary + the two outcomes ---------- */}
          <section className="card">
            <header className="px-6 py-5 border-b border-[--line] flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl">Your order</h2>
              <Link href={back.edit} className="text-sm text-gold hover:text-gold-deep underline">
                Edit {back.label}
              </Link>
            </header>

            <div className="px-6 py-6">
              <div className="leader">
                <span>
                  <span className="block font-semibold">{lineItem.name}</span>
                  <span className="block text-sm text-pale/70 mt-0.5 tnum">{lineItem.note}</span>
                </span>
                <span className="fill" />
                <span className="tnum text-lg">{formatPence(pence)}</span>
              </div>

              <div className="mt-6 pt-5 border-t border-[--line] flex items-baseline justify-between">
                <span className="accent text-gold">Total due now</span>
                <span className="display text-3xl tnum text-gold">{formatPence(pence)}</span>
              </div>

              <p className="mt-3 text-sm text-pale/70">{lineItem.terms}</p>
            </div>

            <div className="px-6 pb-6">
              <p className="text-sm text-pale/70 leading-relaxed border-l-2 border-gold bg-gold/10 px-4 py-3">
                <strong className="text-pale">This is a demonstration.</strong> Stripe is not connected yet, so
                this page stands in for it and no money moves. Choose an outcome below to see exactly what a
                guest would experience either way.
              </p>

              <div className="mt-6 grid gap-3">
                <a href={safe(success)} className="btn btn-gold text-center">
                  Pay {formatPence(pence)}
                </a>
                <a href={safe(cancel)} className="btn text-center border border-brick/50 text-clay hover:bg-clay/10">
                  Simulate a declined card
                </a>
              </div>

              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <Link href={back.edit} className="text-pale/70 hover:text-gold underline">
                  Change the amount
                </Link>
                <a href={safe(cancel)} className="text-pale/70 hover:text-gold underline">
                  Cancel and start again
                </a>
                <Link href={back.home} className="text-pale/70 hover:text-gold underline">
                  Return to the restaurant
                </Link>
              </div>
            </div>
          </section>

          {/* ---------- what happens next, and the trust panel ---------- */}
          <aside className="grid gap-6">
            <section className="card px-6 py-6">
              <h2 className="accent text-gold">What happens next</h2>
              <ol className="mt-4 grid gap-3 text-sm text-pale/70">
                <li className="flex gap-3">
                  <span className="text-gold tnum shrink-0">1</span>
                  <span>Payment is taken on Stripe&rsquo;s own secure page.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-gold tnum shrink-0">2</span>
                  <span>
                    {isVoucher
                      ? "The voucher code is issued and emailed to the recipient."
                      : "Your table is confirmed and a confirmation email is sent."}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-gold tnum shrink-0">3</span>
                  <span>
                    If the payment fails,{" "}
                    {isVoucher ? "no code is issued" : "the table is released"} and nothing is charged.
                  </span>
                </li>
              </ol>
            </section>

            <section className="card px-6 py-6">
              <h2 className="accent text-gold">Payment security</h2>
              <ul className="mt-4 grid gap-2.5 text-sm text-pale/70">
                <li>Card details never reach this website.</li>
                <li>Payments are processed by Stripe.</li>
                <li>Nothing is issued or confirmed until the payment clears.</li>
              </ul>
              <p className="mt-4 text-sm">
                <Link href={`${back.home}/terms`} className="text-gold hover:text-gold-deep underline">
                  Terms &amp; conditions
                </Link>
                <span className="text-pale/40"> · </span>
                <Link href={`${back.home}/privacy`} className="text-gold hover:text-gold-deep underline">
                  Privacy
                </Link>
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
