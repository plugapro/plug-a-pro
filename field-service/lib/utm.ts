const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const
const STORAGE_KEY = 'pap_utm_first_touch'
const MAX_VALUE_LENGTH = 200

export type StoredUtm = Partial<Record<(typeof UTM_KEYS)[number], string>>

export function captureUtmFromLocation() {
  if (typeof window === 'undefined') return
  try {
    // First touch wins: the campaign that brought the visitor here gets the credit,
    // not a later revisit through a different link.
    if (window.localStorage.getItem(STORAGE_KEY)) return

    const params = new URLSearchParams(window.location.search)
    const data: StoredUtm = {}
    for (const key of UTM_KEYS) {
      const value = params.get(key)?.trim()
      if (value) data[key] = value.slice(0, MAX_VALUE_LENGTH)
    }
    if (Object.keys(data).length === 0) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Storage unavailable (private mode) — attribution is best-effort
  }
}

export function getStoredUtm(): StoredUtm | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const data: StoredUtm = {}
    for (const key of UTM_KEYS) {
      const value = parsed[key]
      if (typeof value === 'string' && value) data[key] = value.slice(0, MAX_VALUE_LENGTH)
    }
    return Object.keys(data).length > 0 ? data : null
  } catch {
    return null
  }
}
