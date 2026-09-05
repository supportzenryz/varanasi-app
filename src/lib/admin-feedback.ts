import "server-only";
import { redirect } from "next/navigation";

/**
 * Telling the person at the keyboard what just happened.
 *
 * Most admin actions did neither half of this. On success they re-rendered the
 * same screen with no acknowledgement — which is exactly what a broken button
 * looks like, and is why "the save reservations button doesn't work" was
 * reported for a button that worked. On bad input they did something worse:
 *
 *     if (!guestName || !date || !time || !partySize) return;
 *
 * a silent no-op. The manager typed a booking, pressed Add, the page came back
 * empty, and the booking did not exist. Nothing said why.
 *
 * So: every action ends in one of these two. `ok` for done, `problem` for
 * refused-and-here-is-why. The message travels in the URL because these are
 * server actions ending in a redirect and there is no state to hold it in;
 * it is rendered as text, never as markup, and it is written by this codebase
 * rather than echoed from user input.
 */
export function ok(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}saved=${encodeURIComponent(message)}`);
}

export function problem(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}problem=${encodeURIComponent(message)}`);
}
