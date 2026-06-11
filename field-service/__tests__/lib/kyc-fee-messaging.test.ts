import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  getKycFeeStatus: vi.fn(),
}))

vi.mock('../../lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('../../lib/kyc-fee/ledger', () => ({ getKycFeeStatus: mocks.getKycFeeStatus }))

import { kycFeeOutcomeSentence } from '../../lib/kyc-fee/messaging'

describe('kycFeeOutcomeSentence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isEnabled.mockResolvedValue(true)
  })

  it('returns null when the fee accrual flag is off', async () => {
    mocks.isEnabled.mockResolvedValue(false)
    const result = await kycFeeOutcomeSentence('prov-1')
    expect(result).toBeNull()
    expect(mocks.getKycFeeStatus).not.toHaveBeenCalled()
  })

  it('returns the sponsored sentence when fee is sponsored with 0 outstanding', async () => {
    mocks.getKycFeeStatus.mockResolvedValue({
      outstandingCents: 0,
      lastReason: 'KYC_FEE_SPONSORED',
    })
    const result = await kycFeeOutcomeSentence('prov-1')
    expect(result).toBe(
      'Good news: your once-off ID verification fee has been covered by a Plug A Pro launch voucher - nothing to pay.',
    )
  })

  it('returns the accrual sentence containing the amount and "first top-up" when outstanding > 0', async () => {
    mocks.getKycFeeStatus.mockResolvedValue({
      outstandingCents: 2000,
      lastReason: 'KYC_FEE_ACCRUED',
    })
    const result = await kycFeeOutcomeSentence('prov-1')
    expect(result).toContain('R20')
    expect(result).toContain('first top-up')
  })

  it('returns null when outstanding is 0 and lastReason is null (no fee row)', async () => {
    mocks.getKycFeeStatus.mockResolvedValue({
      outstandingCents: 0,
      lastReason: null,
    })
    const result = await kycFeeOutcomeSentence('prov-1')
    expect(result).toBeNull()
  })
})
