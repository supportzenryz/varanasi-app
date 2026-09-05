/**
 * The banner that goes with lib/admin-feedback. One component so that "it
 * saved" and "it didn't, because…" look the same on every admin screen.
 *
 * Server-rendered from the query string: no client JavaScript, and it survives
 * the redirect that server actions end with.
 */
export function AdminNotice({ saved, problem }: { saved?: string; problem?: string }) {
  if (problem) {
    return (
      <div role="alert" className="mb-6 border-l-2 border-brick bg-brick/8 px-4 py-3 text-sm">
        <strong className="font-semibold">Not saved.</strong> {problem}
      </div>
    );
  }
  if (saved) {
    return (
      <div role="status" className="mb-6 border-l-2 border-leaf bg-leaf/10 px-4 py-3 text-sm">
        {saved}
      </div>
    );
  }
  return null;
}
