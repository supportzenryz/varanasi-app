"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

const KEY = "varanasi_cookie_consent";

/**
 * GA4 behind a consent gate.
 *
 * The old site had no analytics at all — nothing to migrate, and no baseline —
 * so this is where one starts. Two rules it follows:
 *
 *  1. Nothing loads until a visitor accepts. Under UK GDPR/PECR, analytics
 *     cookies need consent first, so the tag isn't even fetched before then.
 *  2. No measurement ID, no banner. The site shouldn't nag people about
 *     cookies it isn't setting.
 *
 * The choice is remembered in localStorage, which is a per-device preference,
 * not personal data leaving the browser.
 */
export function Analytics({ measurementId, consentRequired }: {
  measurementId: string;
  consentRequired: boolean;
}) {
  const [choice, setChoice] = useState<"unknown" | "yes" | "no">("unknown");

  useEffect(() => {
    if (!measurementId) return;
    if (!consentRequired) { setChoice("yes"); return; }
    try {
      const saved = localStorage.getItem(KEY);
      setChoice(saved === "yes" ? "yes" : saved === "no" ? "no" : "unknown");
    } catch {
      // private browsing, or cookies blocked entirely — treat as undecided but
      // don't keep asking, since we can't remember the answer anyway
      setChoice("no");
    }
  }, [measurementId, consentRequired]);

  const decide = (value: "yes" | "no") => {
    try { localStorage.setItem(KEY, value); } catch { /* nothing we can do */ }
    setChoice(value);
  };

  if (!measurementId) return null;

  return (
    <>
      {choice === "yes" && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${measurementId}',{anonymize_ip:true});`}
          </Script>
        </>
      )}

      {choice === "unknown" && (
        <div role="dialog" aria-label="Cookies"
          className="fixed bottom-0 inset-x-0 z-[60] border-t border-[--line] bg-ink/97 backdrop-blur-sm">
          <div className="mx-auto max-w-[84rem] px-5 lg:px-10 py-5 flex flex-wrap items-center gap-x-8 gap-y-4">
            <p className="text-sm text-pale/75 flex-1 min-w-[18rem]">
              We&rsquo;d like to use analytics cookies to see which pages are useful and which aren&rsquo;t.
              Nothing is loaded unless you say yes, and we don&rsquo;t use them for advertising.
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => decide("yes")} className="btn btn-gold !py-2.5 !px-5">Accept</button>
              <button onClick={() => decide("no")} className="btn btn-outline !py-2.5 !px-5">Decline</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Fires a GA4 event, but only if the tag actually loaded. */
export function track(event: string, params?: Record<string, unknown>) {
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag === "function") w.gtag("event", event, params ?? {});
}
