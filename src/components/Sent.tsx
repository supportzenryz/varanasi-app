"use client";
import { useEffect, useRef } from "react";

/**
 * The one confirmation/error banner every enquiry form shares.
 *
 * It scrolls itself into view, which is not decoration. Measured on a phone
 * before this existed: after submitting, the browser lands at the top of the
 * page and the banner sits at y=826 on catering, y=1593 on contact, y=2494 on
 * corporate — all far below a 667px viewport. The guest pressed "Send", the
 * page jumped to the hero photograph, and nothing visible changed. Every one
 * of those forms looked broken while working perfectly.
 *
 * A client component only for that. focus() as well as scroll, so the message
 * is announced to a screen reader rather than merely being on screen.
 */
export function Sent({ sent, error }: { sent: boolean; error?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sent && !error) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [sent, error]);

  if (error) {
    return (
      <div
        ref={ref}
        tabIndex={-1}
        role="alert"
        className="mb-7 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick scroll-mt-28 outline-none"
      >
        {error}
      </div>
    );
  }
  if (!sent) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className="mb-7 border-l-2 border-leaf bg-leaf/10 px-4 py-4 scroll-mt-28 outline-none"
    >
      <p className="font-semibold">Thank you — your enquiry has reached us.</p>
      <p className="text-sm text-pale/70 mt-1.5">
        We&rsquo;ve emailed you a copy for your records, and a member of the team will reply personally,
        usually within one working day.
      </p>
    </div>
  );
}
