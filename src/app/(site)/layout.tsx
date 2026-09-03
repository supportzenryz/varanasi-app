import "../globals.css";
import { analyticsRules } from "@/lib/booking-config";
import { Analytics } from "@/components/Analytics";

/**
 * The public site runs on the dark palette — ink ground, gold accents, the way
 * the printed menus and the original site read. `on-dark` is what tells the
 * form controls (which default to a white box) to follow it.
 *
 * No footer here: the branch layout renders SiteFooter, and the root
 * "choose a location" page is a full-viewport splash that deliberately has
 * none. Putting one at this level gave the branch pages two.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const analytics = analyticsRules();
  return (
    <div className="on-dark bg-ink text-pale min-h-dvh">
      {children}
      <Analytics
        measurementId={analytics.ga4MeasurementId}
        consentRequired={analytics.consentRequired}
      />
    </div>
  );
}
