import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyReferralAudience, toReferralAttribution } from '@/lib/whatsapp-referral'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('classifyReferralAudience', () => {
  it('classifies the live West Rand provider-recruitment creative as provider_recruitment', () => {
    expect(
      classifyReferralAudience({
        source_type: 'ad',
        source_id: '120245406174700243',
        headline: 'Plug A Pro',
        body:
          'Skilled with your hands? Plug A Pro is looking for practical local service providers.\n\n' +
          'If you do home repairs, maintenance, installations, outdoor work, finishing work, or ' +
          'general trade services, you can register your profile and get seen by customers looking ' +
          'for trusted local help.',
      }),
    ).toBe('provider_recruitment')
  })

  it('classifies via the CTWA_PROVIDER_AD_IDS env allowlist even with unrelated copy', () => {
    vi.stubEnv('CTWA_PROVIDER_AD_IDS', '111, 222,333')
    expect(
      classifyReferralAudience({ source_type: 'ad', source_id: '222', body: 'totally generic copy' }),
    ).toBe('provider_recruitment')
  })

  it('returns unknown for customer-flavoured or unclassifiable creative', () => {
    expect(
      classifyReferralAudience({ source_type: 'ad', source_id: '999', body: 'Need a plumber today? Book trusted local help in minutes.' }),
    ).toBe('unknown')
    expect(classifyReferralAudience({ source_type: 'ad', source_id: '999' })).toBe('unknown')
    expect(classifyReferralAudience(null)).toBe('unknown')
    expect(classifyReferralAudience(undefined)).toBe('unknown')
  })
})

describe('toReferralAttribution', () => {
  it('reduces a referral to the persistable snapshot', () => {
    const attribution = toReferralAttribution({
      source_type: 'ad',
      source_id: 'ad-1',
      ctwa_clid: 'clid-1',
      headline: 'Plug A Pro',
      body: 'irrelevant for storage',
    })
    expect(attribution).toMatchObject({
      sourceType: 'ad',
      sourceId: 'ad-1',
      ctwaClid: 'clid-1',
      headline: 'Plug A Pro',
    })
    expect(typeof attribution?.capturedAt).toBe('string')
  })

  it('caps the stored headline at 200 chars', () => {
    const attribution = toReferralAttribution({ source_id: 'ad-1', headline: 'x'.repeat(500) })
    expect(attribution?.headline).toHaveLength(200)
  })

  it('returns null when there is nothing identifying to store', () => {
    expect(toReferralAttribution(null)).toBeNull()
    expect(toReferralAttribution(undefined)).toBeNull()
    expect(toReferralAttribution({ headline: 'no ids at all' })).toBeNull()
  })

  it('keeps a ctwa_clid-only referral (source_id absent)', () => {
    const attribution = toReferralAttribution({ ctwa_clid: 'clid-only' })
    expect(attribution).toMatchObject({ sourceId: null, ctwaClid: 'clid-only', sourceType: 'unknown' })
  })
})
