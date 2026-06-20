"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { applyConsentToGtag, readConsent, writeConsent } from "@/lib/consent";

// POPIA-aware Google Consent Mode v2 banner.
// GA loads with consent defaulted to "denied" (see the consent-default script in
// the root layout), so no analytics/ad cookies are set until the visitor accepts.
// This banner lets them grant per category and persists the choice.

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const stored = readConsent();
    if (stored) {
      // Re-apply a returning visitor's prior choice (consent isn't persisted
      // across page loads by gtag itself once defaulted to denied).
      applyConsentToGtag(stored);
      return;
    }
    // Consent is unknown only on the client (localStorage), so the banner must be
    // revealed in this mount effect; it renders hidden on the server to match SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, []);

  function save(next: { analytics: boolean; marketing: boolean }) {
    const consent = writeConsent(next);
    applyConsentToGtag(consent);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            We use cookies to keep the site working, improve it, and reach more customers. You
            choose what we set. See our{" "}
            <Link
              href="/privacy"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            .
          </p>
          {!customising && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCustomising(true)}>
                Customise
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => save({ analytics: false, marketing: false })}
              >
                Reject all
              </Button>
              <Button size="sm" onClick={() => save({ analytics: true, marketing: true })}>
                Accept all
              </Button>
            </div>
          )}
        </div>

        {customising && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Essential</p>
                <p className="text-xs leading-snug text-muted-foreground">
                  Required for the site to work. Always on.
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">Always on</span>
            </div>

            <label className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Analytics</p>
                <p className="text-xs leading-snug text-muted-foreground">
                  Helps us understand what works.
                </p>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Analytics cookies"
              />
            </label>

            <label className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Marketing</p>
                <p className="text-xs leading-snug text-muted-foreground">
                  Lets us show you Plug A Pro ads on other sites.
                </p>
              </div>
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Marketing cookies"
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCustomising(false)}>
                Back
              </Button>
              <Button size="sm" onClick={() => save({ analytics, marketing })}>
                Save choices
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
