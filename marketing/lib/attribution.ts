// First-touch + last-touch attribution capture for the marketing site. Mirrors
// field-service/lib/attribution.ts so the customer's source survives the
// cross-domain hop from plugapro.co.za to app.plugapro.co.za. If you change
// this file, update the field-service mirror in the same PR.
//
// Captured:
//   - UTMs: source, medium, campaign, term, content
//   - Click IDs: gclid, gbraid, wbraid, fbclid, msclkid
//   - Context: document.referrer (excluding self), landing pathname
//   - Timestamp: captured_at (ISO)
//
// Persisted (localStorage, first-party only):
//   - pap_attribution_first_touch — set ONCE, never overwritten
//   - pap_attribution_last_touch  — refreshed on every visit that brings any
//                                    attribution param or a non-self referrer
//
// Consent note: first-party UTM/click-id state in localStorage. Nothing is
// sent to Google/Meta from here — that's gated on the consent banner.

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export const CLICK_ID_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
] as const;

export interface AttributionSnapshot {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  msclkid?: string;
  referrer?: string;
  landing_path?: string;
  captured_at: string;
}

export interface AttributionState {
  first_touch: AttributionSnapshot | null;
  last_touch: AttributionSnapshot | null;
}

const FIRST_TOUCH_KEY = "pap_attribution_first_touch";
const LAST_TOUCH_KEY = "pap_attribution_last_touch";
const LEGACY_UTM_KEY = "pap_utm_first_touch";

const MAX_VALUE_LENGTH = 200;

function trim(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.slice(0, MAX_VALUE_LENGTH);
}

function isSelfReferrer(referrer: string): boolean {
  try {
    return new URL(referrer).hostname.endsWith("plugapro.co.za");
  } catch {
    return false;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private mode etc.) — best effort
  }
}

function readSnapshotFromUrl(): AttributionSnapshot | null {
  const params = new URLSearchParams(window.location.search);
  const captured: Partial<AttributionSnapshot> = {};
  let hasAttributionParam = false;

  for (const key of UTM_KEYS) {
    const v = trim(params.get(key));
    if (v) {
      captured[key] = v;
      hasAttributionParam = true;
    }
  }
  for (const key of CLICK_ID_KEYS) {
    const v = trim(params.get(key));
    if (v) {
      captured[key] = v;
      hasAttributionParam = true;
    }
  }

  const referrer = trim(document.referrer);
  if (referrer && !isSelfReferrer(referrer)) captured.referrer = referrer;
  const landing = trim(window.location.pathname);
  if (landing) captured.landing_path = landing;

  if (!hasAttributionParam && !captured.referrer) return null;

  return {
    ...captured,
    captured_at: new Date().toISOString(),
  };
}

function migrateLegacyUtmKey(): void {
  if (window.localStorage.getItem(FIRST_TOUCH_KEY)) return;
  const legacy = readJson<Partial<Record<(typeof UTM_KEYS)[number], string>>>(LEGACY_UTM_KEY);
  if (!legacy) return;
  const snap: AttributionSnapshot = {
    captured_at: new Date(0).toISOString(),
    ...(legacy.utm_source ? { utm_source: legacy.utm_source } : {}),
    ...(legacy.utm_medium ? { utm_medium: legacy.utm_medium } : {}),
    ...(legacy.utm_campaign ? { utm_campaign: legacy.utm_campaign } : {}),
    ...(legacy.utm_content ? { utm_content: legacy.utm_content } : {}),
  };
  writeJson(FIRST_TOUCH_KEY, snap);
}

export function captureAttributionFromLocation(): AttributionState | null {
  if (typeof window === "undefined") return null;
  migrateLegacyUtmKey();
  const snap = readSnapshotFromUrl();
  if (!snap) return getStoredAttribution();

  if (!window.localStorage.getItem(FIRST_TOUCH_KEY)) {
    writeJson(FIRST_TOUCH_KEY, snap);
  }
  writeJson(LAST_TOUCH_KEY, snap);
  return getStoredAttribution();
}

export function getStoredAttribution(): AttributionState | null {
  if (typeof window === "undefined") return null;
  const first = readJson<AttributionSnapshot>(FIRST_TOUCH_KEY);
  const last = readJson<AttributionSnapshot>(LAST_TOUCH_KEY);
  if (!first && !last) return null;
  return { first_touch: first, last_touch: last };
}
