/** The one confirmation/error banner every enquiry form shares. */
export function Sent({ sent, error }: { sent: boolean; error?: string }) {
  if (error) {
    return (
      <p role="alert" className="mb-7 border-l-2 border-brick bg-clay/10 px-4 py-3 text-sm text-brick">
        {error}
      </p>
    );
  }
  if (!sent) return null;
  return (
    <div role="status" className="mb-7 border-l-2 border-leaf bg-leaf/10 px-4 py-4">
      <p className="font-semibold">Thank you — your enquiry has reached us.</p>
      <p className="text-sm text-pale/70 mt-1.5">
        We&rsquo;ve emailed you a copy for your records, and a member of the team will reply personally,
        usually within one working day.
      </p>
    </div>
  );
}
