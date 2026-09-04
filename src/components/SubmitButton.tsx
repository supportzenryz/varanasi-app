"use client";
import { useFormStatus } from "react-dom";

/**
 * A submit button that disables itself while its form is in flight.
 *
 * Every form on the site used a plain <button>, so a second click sent a
 * second request. Measured before this existed: one triple-click on "Pay and
 * confirm" created three held bookings for the same guest and slot, taking 12
 * of 30 covers out of the evening, of which only the last reached checkout.
 * The contact form produced two enquiries, two alerts to the restaurant and
 * two acknowledgements to the guest.
 *
 * useFormStatus reads the pending state of the enclosing form, which means
 * this works with plain server actions and needs no state passed down. It is
 * the only client component in the booking flow, and it is one button.
 *
 * This is the polite half of the fix. It relies on JavaScript, so the server
 * refuses duplicates as well — see the dedupe in holdBooking.
 */
export function SubmitButton({
  children,
  className = "btn btn-gold",
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  /** What to say while it is working. Defaults to the label with an ellipsis. */
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:opacity-60 disabled:cursor-wait`}
    >
      {pending ? (pendingLabel ?? "Just a moment…") : children}
    </button>
  );
}
