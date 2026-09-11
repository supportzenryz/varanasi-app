import { readNotice } from "@/lib/flash";

/**
 * The banner that goes with lib/admin-feedback. One component so that "it
 * saved" and "it didn't, because…" look the same on every admin screen.
 *
 * It reads the message from a cookie rather than from props, which fixes a
 * quiet fault as a side effect: the weekly-email screen rendered
 * `<AdminNotice n={n} />` with no props at all, so saving a draft there confirmed
 * nothing — the same "did that work?" the whole mechanism exists to prevent.
 * There is nothing left to forget to pass except the nonce, and without it the
 * banner simply does not appear.
 *
 * Server-rendered, so no client JavaScript, and it survives the redirect that
 * every server action ends with.
 */
export function AdminNotice({ n }: { n?: string }) {
  const notice = readNotice(n);
  if (!notice) return null;

  if (notice.kind === "problem") {
    return (
      <div role="alert" className="mb-6 border-l-2 border-brick bg-brick/8 px-4 py-3 text-sm">
        <strong className="font-semibold">Not saved.</strong> {notice.message}
      </div>
    );
  }
  return (
    <div role="status" className="mb-6 border-l-2 border-leaf bg-leaf/10 px-4 py-3 text-sm">
      {notice.message}
    </div>
  );
}
