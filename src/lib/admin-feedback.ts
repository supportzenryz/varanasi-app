import "server-only";
import { redirect } from "next/navigation";
import { stashNotice } from "@/lib/flash";

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
 * refused-and-here-is-why.
 *
 * Both stay synchronous and both still return `never`, which is what lets
 * TypeScript treat the line after them as unreachable — the narrowing that
 * makes `if (!name.ok) problem(BACK, name.error);` safe on the next line.
 * The message no longer travels in the URL (see lib/flash.ts); only an opaque
 * nonce does.
 */

export function ok(path: string, message: string, context?: string): never {
  const n = stashNotice({ kind: "ok", message, context });
  redirect(`${path}${path.includes("?") ? "&" : "?"}n=${n}`);
}

export function problem(path: string, message: string, context?: string): never {
  const n = stashNotice({ kind: "problem", message, context });
  redirect(`${path}${path.includes("?") ? "&" : "?"}n=${n}`);
}
