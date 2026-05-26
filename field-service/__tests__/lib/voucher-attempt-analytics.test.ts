import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/db', () => ({
  db: {
    voucherRedemptionAttempt: {
      create: vi.fn(),
    },
  },
}))

import {
  buildVoucherRedemptionAttemptMetadata,
  recordVoucherRedemptionAttempt,
  type VoucherRedemptionAttemptClient,
} from '../../lib/voucher-attempt-analytics'

function makeClient(create = vi.fn().mockResolvedValue({ id: 'attempt_1' })): VoucherRedemptionAttemptClient {
  return {
    voucherRedemptionAttempt: { create },
  }
}

describe('voucher attempt analytics', () => {
  it('builds tolerant safe metadata without retaining voucher input', () => {
    const metadata = buildVoucherRedemptionAttemptMetadata('  pap-7kq9 _ m2xd  ')

    expect(metadata).toEqual({
      normalizedLength: 11,
      normalizedLengthBucket: 'EXPECTED_WITH_PREFIX',
      hadPapPrefix: true,
      separatorBucket: 'MIXED',
      separatorCount: 8,
    })
  })

  it('records only safe attempt fields and omits raw, canonical, and hash-like voucher data', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'attempt_1' })
    const client = makeClient(create)

    await recordVoucherRedemptionAttempt({
      providerId: 'prov_1',
      channel: 'WHATSAPP',
      outcome: 'REDEMPTION_FAILED',
      rawInput: 'PAP-7KQ9-M2XD',
      redemptionErrorCode: 'VOUCHER_NOT_FOUND',
      parseFailureReason: 'MALFORMED',
      campaignCode: 'PILOT_PROVIDER_FLYER',
      wouldRateLimit: true,
      rateLimited: false,
    }, client)

    expect(create).toHaveBeenCalledWith({
      data: {
        providerId: 'prov_1',
        channel: 'WHATSAPP',
        outcome: 'REDEMPTION_FAILED',
        redemptionErrorCode: 'VOUCHER_NOT_FOUND',
        parseFailureReason: 'MALFORMED',
        normalizedLength: 11,
        normalizedLengthBucket: 'EXPECTED_WITH_PREFIX',
        hadPapPrefix: true,
        separatorBucket: 'DASH',
        separatorCount: 2,
        campaignCode: 'PILOT_PROVIDER_FLYER',
        wouldRateLimit: true,
        rateLimited: false,
      },
    })

    const payload = JSON.stringify(create.mock.calls[0]?.[0]?.data)
    expect(payload).not.toContain('PAP-7KQ9-M2XD')
    expect(payload).not.toContain('PAP7KQ9M2XD')
    expect(payload).not.toMatch(/[a-f0-9]{64}/i)
    expect(Object.keys(create.mock.calls[0]?.[0]?.data ?? {})).not.toEqual(
      expect.arrayContaining(['rawInput', 'canonical', 'canonicalCode', 'codeHash', 'voucherCode', 'voucherId']),
    )
  })

  it('swallows analytics insert failures so redemption is never blocked', async () => {
    const create = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const client = makeClient(create)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(recordVoucherRedemptionAttempt({
      providerId: 'prov_1',
      channel: 'PWA',
      outcome: 'SUCCESS',
      rawInput: '7KQ9M2XD',
    }, client)).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      '[voucher-attempt-analytics] failed to record voucher redemption attempt',
      expect.objectContaining({
        providerId: 'prov_1',
        channel: 'PWA',
        outcome: 'SUCCESS',
        error: expect.any(Error),
      }),
    )

    warnSpy.mockRestore()
  })
})
