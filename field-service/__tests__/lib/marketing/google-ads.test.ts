import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = [
  'NEXT_PUBLIC_GOOGLE_ADS_ID',
  'NEXT_PUBLIC_GOOGLE_ADS_QUOTE_CONVERSION_LABEL',
  'NEXT_PUBLIC_GOOGLE_ADS_BOOKING_CONVERSION_LABEL',
  'NEXT_PUBLIC_GOOGLE_ADS_PAYMENT_CONVERSION_LABEL',
  'NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_CONVERSION_LABEL',
  'NEXT_PUBLIC_GOOGLE_ADS_PHONE_CONVERSION_LABEL',
] as const

type GtagWindow = typeof window & { gtag?: (...args: unknown[]) => void }

const originalEnv: Record<string, string | undefined> = {}

async function importFresh() {
  vi.resetModules()
  return import('../../../lib/marketing/google-ads')
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
  // jsdom is not enabled — install a minimal window stub for these tests only.
  ;(globalThis as { window?: GtagWindow }).window = {} as unknown as GtagWindow
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
  delete (globalThis as { window?: GtagWindow }).window
})

describe('fireGoogleAdsConversion', () => {
  it('does nothing when NEXT_PUBLIC_GOOGLE_ADS_ID is unset', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_QUOTE_CONVERSION_LABEL = 'AbC123'
    const gtag = vi.fn()
    ;(globalThis as { window?: GtagWindow }).window!.gtag = gtag

    const { fireGoogleAdsConversion } = await importFresh()
    fireGoogleAdsConversion('quote', { value: 100, currency: 'ZAR' })

    expect(gtag).not.toHaveBeenCalled()
  })

  it('does nothing when the event label env var is unset', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-123456'
    const gtag = vi.fn()
    ;(globalThis as { window?: GtagWindow }).window!.gtag = gtag

    const { fireGoogleAdsConversion } = await importFresh()
    fireGoogleAdsConversion('booking')

    expect(gtag).not.toHaveBeenCalled()
  })

  it('does nothing when window.gtag is not present', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-123456'
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PAYMENT_CONVERSION_LABEL = 'PAY01'

    const { fireGoogleAdsConversion } = await importFresh()
    expect(() => fireGoogleAdsConversion('payment')).not.toThrow()
  })

  it('fires gtag with send_to=<ID>/<LABEL> when both ID and label are set', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-123456'
    process.env.NEXT_PUBLIC_GOOGLE_ADS_QUOTE_CONVERSION_LABEL = 'QUOTE_LBL'
    const gtag = vi.fn()
    ;(globalThis as { window?: GtagWindow }).window!.gtag = gtag

    const { fireGoogleAdsConversion } = await importFresh()
    fireGoogleAdsConversion('quote', {
      value: 250,
      currency: 'ZAR',
      transactionId: 'job_abc',
    })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-123456/QUOTE_LBL',
      value: 250,
      currency: 'ZAR',
      transaction_id: 'job_abc',
    })
  })

  it('routes whatsapp and phone events to their distinct labels', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-9'
    process.env.NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_CONVERSION_LABEL = 'WA1'
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PHONE_CONVERSION_LABEL = 'PH1'
    const gtag = vi.fn()
    ;(globalThis as { window?: GtagWindow }).window!.gtag = gtag

    const { fireGoogleAdsConversion } = await importFresh()
    fireGoogleAdsConversion('whatsapp', { transactionId: 'home_hero' })
    fireGoogleAdsConversion('phone', { transactionId: 'help_footer' })

    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'conversion', {
      send_to: 'AW-9/WA1',
      transaction_id: 'home_hero',
    })
    expect(gtag).toHaveBeenNthCalledWith(2, 'event', 'conversion', {
      send_to: 'AW-9/PH1',
      transaction_id: 'help_footer',
    })
  })
})
