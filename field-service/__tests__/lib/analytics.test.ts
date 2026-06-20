import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type GtagWindow = typeof window & {
  gtag?: (...args: unknown[]) => void
  sessionStorage: Storage
}

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
}

let gtag: ReturnType<typeof vi.fn>

async function importFresh() {
  vi.resetModules()
  return import('../../lib/analytics')
}

beforeEach(() => {
  gtag = vi.fn()
  ;(globalThis as { window?: GtagWindow }).window = {
    gtag,
    sessionStorage: new MemoryStorage(),
  } as unknown as GtagWindow
})

afterEach(() => {
  delete (globalThis as { window?: GtagWindow }).window
})

describe('analytics', () => {
  it('whatsappClick fires whatsapp_click with source + cta_label and does NOT dedup', async () => {
    const { analytics } = await importFresh()
    analytics.whatsappClick({ source: 'home_hero', cta_label: 'Chat now' })
    analytics.whatsappClick({ source: 'home_hero', cta_label: 'Chat now' })

    expect(gtag).toHaveBeenCalledTimes(2)
    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'whatsapp_click', {
      source: 'home_hero',
      cta_label: 'Chat now',
    })
  })

  it('phoneClick fires phone_click and does NOT dedup', async () => {
    const { analytics } = await importFresh()
    analytics.phoneClick({ source: 'help_footer', cta_label: 'Call us' })
    analytics.phoneClick({ source: 'help_footer', cta_label: 'Call us' })

    expect(gtag).toHaveBeenCalledTimes(2)
    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'phone_click', {
      source: 'help_footer',
      cta_label: 'Call us',
    })
  })

  it('quoteStarted fires quote_started once per service slug per session', async () => {
    const { analytics } = await importFresh()
    analytics.quoteStarted({ service_slug: 'plumbing', category: 'plumbing', area: 'jhb' })
    analytics.quoteStarted({ service_slug: 'plumbing', category: 'plumbing', area: 'jhb' })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'quote_started', {
      service_slug: 'plumbing',
      category: 'plumbing',
      area: 'jhb',
    })
  })

  it('slotSelected fires slot_selected once per job_request_id with window fields', async () => {
    const { analytics } = await importFresh()
    analytics.slotSelected({
      job_request_id: 'jr_1',
      window_start: '2026-06-20T09:00:00Z',
      window_end: '2026-06-20T11:00:00Z',
    })
    analytics.slotSelected({ job_request_id: 'jr_1' })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'slot_selected', {
      job_request_id: 'jr_1',
      window_start: '2026-06-20T09:00:00Z',
      window_end: '2026-06-20T11:00:00Z',
    })
  })

  it('bookingStarted fires booking_started once per job_request_id', async () => {
    const { analytics } = await importFresh()
    analytics.bookingStarted({ job_request_id: 'jr_2' })
    analytics.bookingStarted({ job_request_id: 'jr_2' })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'booking_started', { job_request_id: 'jr_2' })
  })

  it('requestSubmitted fires request_submitted once per job_request_id', async () => {
    const { analytics } = await importFresh()
    analytics.requestSubmitted({ job_request_id: 'jr_3', category: 'plumbing' })
    analytics.requestSubmitted({ job_request_id: 'jr_3', category: 'plumbing' })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'request_submitted', {
      job_request_id: 'jr_3',
      category: 'plumbing',
    })
  })

  it('does nothing when window.gtag is missing', async () => {
    ;(globalThis as { window?: GtagWindow }).window = {
      sessionStorage: new MemoryStorage(),
    } as unknown as GtagWindow

    const { analytics } = await importFresh()
    expect(() => analytics.whatsappClick({ source: 's', cta_label: 'l' })).not.toThrow()
  })
})
