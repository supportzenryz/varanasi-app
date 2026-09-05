"use client";
import { useFormStatus } from "react-dom";

/**
 * A submit button that asks first, for the actions that cannot be undone.
 *
 * Delete a dish, delete a private room, remove a photograph, cancel a gift
 * voucher — all of these were one click, with no step between the pointer and
 * the deletion, on a screen where the buttons sit inches apart. A manager
 * reordering a menu on a tablet at the pass is one mis-tap from removing a
 * dish, and nothing here has an undo.
 *
 * `confirm()` rather than a bespoke modal: it cannot be missed, it cannot be
 * dismissed by clicking past it, and it works before any JavaScript of ours has
 * hydrated the page. If scripting is off the form still submits — which is the
 * right failure direction for a button a member of staff is relying on.
 */
export function ConfirmButton({ ask, className, children }: {
  ask: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(ask)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
