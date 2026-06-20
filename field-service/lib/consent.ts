// Three-category consent (essential / analytics / marketing) for Google Consent
// Mode v2. Essential is always-on; analytics and marketing each map to one or
// more gtag consent keys. Legacy binary key pap_ga_consent ('granted' | 'denied')
// is migrated forward on first read so returning visitors don't see the banner.

export const STORAGE_KEY = 'pap_consent_v2'
export const LEGACY_KEY = 'pap_ga_consent'
export const CONSENT_VERSION = 1 as const

export type Consent = {
  analytics: boolean
  marketing: boolean
  version: typeof CONSENT_VERSION
  ts: string
}

type GtagWindow = typeof globalThis & { gtag?: (...args: unknown[]) => void }

function isConsent(value: unknown): value is Consent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.analytics === 'boolean' &&
    typeof v.marketing === 'boolean' &&
    v.version === CONSENT_VERSION &&
    typeof v.ts === 'string'
  )
}

function migrateLegacy(raw: string | null): Consent | null {
  if (raw !== 'granted' && raw !== 'denied') return null
  const granted = raw === 'granted'
  return {
    analytics: granted,
    marketing: granted,
    version: CONSENT_VERSION,
    ts: new Date().toISOString(),
  }
}

export function readConsent(): Consent | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isConsent(parsed)) return parsed
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    const migrated = migrateLegacy(legacy)
    if (migrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      return migrated
    }
    return null
  } catch {
    return null
  }
}

export function writeConsent(input: { analytics: boolean; marketing: boolean }): Consent {
  const consent: Consent = {
    analytics: input.analytics,
    marketing: input.marketing,
    version: CONSENT_VERSION,
    ts: new Date().toISOString(),
  }
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent))
    }
  } catch {
    // Private mode or quota exhaustion — the choice still applies for this session.
  }
  return consent
}

export function applyConsentToGtag(consent: Pick<Consent, 'analytics' | 'marketing'>): void {
  if (typeof window === 'undefined') return
  const w = window as GtagWindow
  if (typeof w.gtag !== 'function') return
  const analytics = consent.analytics ? 'granted' : 'denied'
  const marketing = consent.marketing ? 'granted' : 'denied'
  w.gtag('consent', 'update', {
    analytics_storage: analytics,
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
  })
}
