// First-touch + last-touch attribution capture for the booking PWA. Mirrors
// marketing/lib/attribution.ts so the customer's source survives the cross-
// domain hop from plugapro.co.za to app.plugapro.co.za. If you change this
// file, update the marketing mirror in the same PR.
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
// Consent note: this module stores first-party UTM/click-id state in
// localStorage. It does NOT send anything to Google/Meta — that's gated on the
// consent banner elsewhere. Capturing first-party attribution under denied
// consent is fine (no third-party request, no cookie set).
//
// Sensitive-data note: never touches phone numbers, addresses, names, ID
// numbers, or job-note text. landing_path is the pathname only — no query
// string, so even a tokenized URL doesn't get persisted whole. Token routes
// are additionally gated client-side in AttributionCapture.tsx.

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

export const CLICK_ID_KEYS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
] as const

export interface AttributionSnapshot {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  msclkid?: string
  referrer?: string
  landing_path?: string
  // Optional: legacy snapshots migrated from pap_utm_first_touch have no known
  // capture time and deliberately omit this rather than fabricate one.
  captured_at?: string
}

export interface AttributionState {
  first_touch: AttributionSnapshot | null
  last_touch: AttributionSnapshot | null
}

const FIRST_TOUCH_KEY = 'pap_attribution_first_touch'
const LAST_TOUCH_KEY = 'pap_attribution_last_touch'
const LEGACY_UTM_KEY = 'pap_utm_first_touch'

const MAX_VALUE_LENGTH = 200

function trim(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  if (!t) return undefined
  return t.slice(0, MAX_VALUE_LENGTH)
}

function isSelfReferrer(referrer: string): boolean {
  try {
    return new URL(referrer).hostname.endsWith('plugapro.co.za')
  } catch {
    return false
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage unavailable (private mode etc.) — best effort
  }
}

function readSnapshotFromUrl(): AttributionSnapshot | null {
  const params = new URLSearchParams(window.location.search)
  const captured: Partial<AttributionSnapshot> = {}
  let hasAttributionParam = false

  for (const key of UTM_KEYS) {
    const v = trim(params.get(key))
    if (v) {
      captured[key] = v
      hasAttributionParam = true
    }
  }
  for (const key of CLICK_ID_KEYS) {
    const v = trim(params.get(key))
    if (v) {
      captured[key] = v
      hasAttributionParam = true
    }
  }

  const referrer = trim(document.referrer)
  // Symmetric to sanitizeSnapshot — only persist http(s) referrers and
  // same-site paths. Browser already constrains both but the JSON we POST
  // crosses a trust boundary into the admin display path.
  if (
    referrer &&
    !isSelfReferrer(referrer) &&
    (referrer.startsWith('http://') || referrer.startsWith('https://'))
  ) {
    captured.referrer = referrer
  }
  const landing = trim(window.location.pathname)
  if (landing && landing.startsWith('/') && !landing.startsWith('//')) {
    captured.landing_path = landing
  }

  // Empty visit — no UTMs, no click IDs, no external referrer — skip so we
  // don't reset last_touch every time the user clicks around the site.
  if (!hasAttributionParam && !captured.referrer) return null

  return {
    ...captured,
    captured_at: new Date().toISOString(),
  }
}

function migrateLegacyUtmKey(): void {
  // Existing visitors stored a smaller UTM-only snapshot under
  // pap_utm_first_touch. Migrate so their first-touch credit isn't lost when
  // the new key takes over.
  if (window.localStorage.getItem(FIRST_TOUCH_KEY)) return
  const legacy = readJson<Partial<Record<(typeof UTM_KEYS)[number], string>>>(LEGACY_UTM_KEY)
  if (!legacy) return
  const snap: AttributionSnapshot = {
    // True first-touch time is unknown for migrated visitors — omit captured_at
    // rather than fabricate one. Stamping epoch (or now) here would propagate
    // into Customer.firstTouchAt / JobRequest.firstTouchAt and render as a real
    // (wrong) acquisition date; safeIsoToDate() treats the absence as "unknown".
    ...(legacy.utm_source ? { utm_source: legacy.utm_source } : {}),
    ...(legacy.utm_medium ? { utm_medium: legacy.utm_medium } : {}),
    ...(legacy.utm_campaign ? { utm_campaign: legacy.utm_campaign } : {}),
    ...(legacy.utm_content ? { utm_content: legacy.utm_content } : {}),
  }
  writeJson(FIRST_TOUCH_KEY, snap)
}

export function captureAttributionFromLocation(): AttributionState | null {
  if (typeof window === 'undefined') return null
  migrateLegacyUtmKey()
  const snap = readSnapshotFromUrl()
  if (!snap) return getStoredAttribution()

  if (!window.localStorage.getItem(FIRST_TOUCH_KEY)) {
    writeJson(FIRST_TOUCH_KEY, snap)
  }
  writeJson(LAST_TOUCH_KEY, snap)
  return getStoredAttribution()
}

export function getStoredAttribution(): AttributionState | null {
  if (typeof window === 'undefined') return null
  const first = readJson<AttributionSnapshot>(FIRST_TOUCH_KEY)
  const last = readJson<AttributionSnapshot>(LAST_TOUCH_KEY)
  if (!first && !last) return null
  return { first_touch: first, last_touch: last }
}

// Legacy shim. The previous lib/utm.ts exposed the 4-key first-touch shape;
// any caller that hasn't been updated to use getStoredAttribution should keep
// working unchanged.
export type StoredUtm = Partial<
  Pick<AttributionSnapshot, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content'>
>

export function getStoredUtm(): StoredUtm | null {
  const first = getStoredAttribution()?.first_touch
  if (!first) return null
  const result: StoredUtm = {}
  if (first.utm_source) result.utm_source = first.utm_source
  if (first.utm_medium) result.utm_medium = first.utm_medium
  if (first.utm_campaign) result.utm_campaign = first.utm_campaign
  if (first.utm_content) result.utm_content = first.utm_content
  return Object.keys(result).length > 0 ? result : null
}

// Legacy entry point — previous component called captureUtmFromLocation().
export function captureUtmFromLocation(): void {
  captureAttributionFromLocation()
}

// ─── Server-safe parser ────────────────────────────────────────────────────
// Called from the bookings API route to decode the `attributionJson` form
// field the client posts. No window access; safe in any runtime. Defensive
// against malformed payloads, oversize values and unknown root shapes —
// returns null when input can't be trusted.

function sanitizeSnapshot(input: unknown): AttributionSnapshot | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Record<string, unknown>
  const result: Partial<AttributionSnapshot> = {}
  let hasField = false
  for (const key of UTM_KEYS) {
    const raw = v[key]
    if (typeof raw === 'string') {
      const t = trim(raw)
      if (t) {
        result[key] = t
        hasField = true
      }
    }
  }
  for (const key of CLICK_ID_KEYS) {
    const raw = v[key]
    if (typeof raw === 'string') {
      const t = trim(raw)
      if (t) {
        result[key] = t
        hasField = true
      }
    }
  }
  if (typeof v.referrer === 'string') {
    const t = trim(v.referrer)
    // Referrer is captured from document.referrer (a full URL). Only allow
    // http/https — refuse javascript:, data:, file:, vbscript: etc. so a
    // tampered POST can't smuggle an executable URL into the admin display
    // pipeline (admin currently renders referrer as text, but this is
    // defence-in-depth for any future link rendering).
    if (t && (t.startsWith('http://') || t.startsWith('https://'))) {
      result.referrer = t
      hasField = true
    }
  }
  if (typeof v.landing_path === 'string') {
    const t = trim(v.landing_path)
    // landing_path is always a same-site pathname captured from
    // window.location.pathname. Require it to start with `/` and reject
    // protocol-relative URLs (`//evil.com`) so the admin <Link href> in
    // /admin/customers/[id] + /admin/bookings/[id] cannot be hijacked to
    // navigate to an external site or execute a `javascript:` payload.
    if (t && t.startsWith('/') && !t.startsWith('//')) {
      result.landing_path = t
      hasField = true
    }
  }
  if (!hasField) return null
  return {
    ...result,
    captured_at:
      typeof v.captured_at === 'string' && v.captured_at
        ? v.captured_at.slice(0, MAX_VALUE_LENGTH)
        : new Date().toISOString(),
  }
}

export function parseAttributionJson(input: string | null | undefined): AttributionState | null {
  if (!input || typeof input !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(input)
    if (!parsed || typeof parsed !== 'object') return null
    const root = parsed as Record<string, unknown>
    const first = sanitizeSnapshot(root.first_touch)
    const last = sanitizeSnapshot(root.last_touch)
    if (!first && !last) return null
    return { first_touch: first, last_touch: last }
  } catch {
    return null
  }
}
