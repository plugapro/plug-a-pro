"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// POPIA-aware Google Consent Mode v2 banner.
// GA loads with consent defaulted to "denied" (see the consent-default script in
// the root layout), so no analytics/ad cookies are set until the visitor accepts.
// This banner lets them grant or refuse and persists the choice.

const STORAGE_KEY = "pap_ga_consent";
type Choice = "granted" | "denied";

type GtagWindow = typeof window & { gtag?: (...args: unknown[]) => void };

function applyConsent(choice: Choice) {
  const w = window as GtagWindow;
  if (typeof w.gtag !== "function") return;
  w.gtag("consent", "update", {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  });
}

function readStoredChoice(): Choice | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = readStoredChoice();
    if (stored) {
      // Re-apply a returning visitor's prior choice (consent isn't persisted
      // across page loads by gtag itself once defaulted to denied).
      applyConsent(stored);
      return;
    }
    // Consent is unknown only on the client (localStorage), so the banner must be
    // revealed in this mount effect; it renders hidden on the server to match SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, []);

  function choose(choice: Choice) {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // ignore storage failures (private mode); the choice still applies this session
    }
    applyConsent(choice);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          We use analytics cookies to understand how the site is used and improve it.
          No analytics cookies are set unless you accept. See our{" "}
          <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => choose("denied")}>
            Decline
          </Button>
          <Button size="sm" onClick={() => choose("granted")}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
