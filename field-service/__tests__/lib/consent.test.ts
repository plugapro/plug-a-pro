import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONSENT_VERSION,
  LEGACY_KEY,
  STORAGE_KEY,
  applyConsentToGtag,
  readConsent,
  writeConsent,
} from '@/lib/consent'

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    api: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
    },
  }
}

describe('consent helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('writeConsent', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-20T10:00:00.000Z'))
    })

    it('persists the full Consent shape under pap_consent_v2', () => {
      const { store, api } = makeStorage()
      vi.stubGlobal('window', { localStorage: api })

      const consent = writeConsent({ analytics: true, marketing: false })

      expect(consent).toEqual({
        analytics: true,
        marketing: false,
        version: CONSENT_VERSION,
        ts: '2026-06-20T10:00:00.000Z',
      })
      const raw = store.get(STORAGE_KEY)
      expect(raw).toBeDefined()
      expect(JSON.parse(raw!)).toEqual(consent)
    })

    it('returns the choice even if localStorage throws', () => {
      vi.stubGlobal('window', {
        localStorage: {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota')
          },
        },
      })

      const consent = writeConsent({ analytics: false, marketing: true })

      expect(consent.analytics).toBe(false)
      expect(consent.marketing).toBe(true)
      expect(consent.version).toBe(CONSENT_VERSION)
    })
  })

  describe('readConsent', () => {
    it('returns null when nothing is stored', () => {
      const { api } = makeStorage()
      vi.stubGlobal('window', { localStorage: api })

      expect(readConsent()).toBeNull()
    })

    it('returns the parsed Consent for a valid stored entry', () => {
      const stored = {
        analytics: false,
        marketing: true,
        version: 1,
        ts: '2026-06-20T09:00:00.000Z',
      }
      const { api } = makeStorage({ [STORAGE_KEY]: JSON.stringify(stored) })
      vi.stubGlobal('window', { localStorage: api })

      expect(readConsent()).toEqual(stored)
    })

    it('returns null when the stored JSON is malformed', () => {
      const { api } = makeStorage({ [STORAGE_KEY]: '{not-json' })
      vi.stubGlobal('window', { localStorage: api })

      expect(readConsent()).toBeNull()
    })

    it('migrates legacy granted into both categories on', () => {
      const { store, api } = makeStorage({ [LEGACY_KEY]: 'granted' })
      vi.stubGlobal('window', { localStorage: api })

      const migrated = readConsent()
      expect(migrated).toMatchObject({
        analytics: true,
        marketing: true,
        version: CONSENT_VERSION,
      })
      const persisted = store.get(STORAGE_KEY)
      expect(persisted).toBeDefined()
      expect(JSON.parse(persisted!).analytics).toBe(true)
      expect(JSON.parse(persisted!).marketing).toBe(true)
    })

    it('migrates legacy denied into both categories off', () => {
      const { store, api } = makeStorage({ [LEGACY_KEY]: 'denied' })
      vi.stubGlobal('window', { localStorage: api })

      const migrated = readConsent()
      expect(migrated).toMatchObject({
        analytics: false,
        marketing: false,
        version: CONSENT_VERSION,
      })
      const persisted = store.get(STORAGE_KEY)
      expect(persisted).toBeDefined()
      expect(JSON.parse(persisted!).analytics).toBe(false)
      expect(JSON.parse(persisted!).marketing).toBe(false)
    })

    it('prefers pap_consent_v2 when both keys exist', () => {
      const stored = {
        analytics: true,
        marketing: false,
        version: 1,
        ts: '2026-06-20T09:00:00.000Z',
      }
      const { api } = makeStorage({
        [STORAGE_KEY]: JSON.stringify(stored),
        [LEGACY_KEY]: 'denied',
      })
      vi.stubGlobal('window', { localStorage: api })

      expect(readConsent()).toEqual(stored)
    })
  })

  describe('applyConsentToGtag', () => {
    it('calls gtag consent update with the four Consent Mode v2 keys', () => {
      const gtag = vi.fn()
      vi.stubGlobal('window', { gtag, localStorage: makeStorage().api })

      applyConsentToGtag({ analytics: true, marketing: false })

      expect(gtag).toHaveBeenCalledTimes(1)
      expect(gtag).toHaveBeenCalledWith('consent', 'update', {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      })
    })

    it('maps both true to granted across all four keys', () => {
      const gtag = vi.fn()
      vi.stubGlobal('window', { gtag, localStorage: makeStorage().api })

      applyConsentToGtag({ analytics: true, marketing: true })

      expect(gtag).toHaveBeenCalledWith('consent', 'update', {
        analytics_storage: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
      })
    })

    it('is a no-op when gtag is not on window', () => {
      vi.stubGlobal('window', { localStorage: makeStorage().api })

      expect(() => applyConsentToGtag({ analytics: true, marketing: true })).not.toThrow()
    })
  })
})
