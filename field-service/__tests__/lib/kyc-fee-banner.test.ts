import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled, mockGetStatus, mockDb } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockGetStatus: vi.fn(),
  mockDb: {
    provider: { findUnique: vi.fn() },
    kycFeeLedgerEntry: { findFirst: vi.fn() },
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/auth', () => ({
  requireProvider: vi.fn().mockResolvedValue({ id: 'user-1', phone: '+27820000000' }),
}))
vi.mock('@/lib/kyc-fee/ledger', () => ({ getKycFeeStatus: mockGetStatus }))

describe('getProviderKycFeeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-1',
      phone: '+27820000000',
      kycStatus: 'VERIFIED',
    })
  })

  it('shows a settled banner after the fee was recovered, with no follow-up ledger query', async () => {
    mockGetStatus.mockResolvedValue({
      outstandingCents: 0,
      lastReason: 'KYC_FEE_RECOVERED',
      lastAmountCents: 5000,
    })

    const { getProviderKycFeeBanner } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const banner = await getProviderKycFeeBanner()

    expect(banner).toMatchObject({ kind: 'recovered' })
    expect(banner?.text).toContain('R50')
    expect(banner?.text).toContain('1 credit')
    expect(banner?.text.toLowerCase()).toContain('settled')
    expect(mockDb.kycFeeLedgerEntry.findFirst).not.toHaveBeenCalled()
  })

  it('shows the real credit count when the fee is more than one credit', async () => {
    mockGetStatus.mockResolvedValue({
      outstandingCents: 0,
      lastReason: 'KYC_FEE_RECOVERED',
      lastAmountCents: 10_000,
    })

    const { getProviderKycFeeBanner } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const banner = await getProviderKycFeeBanner()

    expect(banner?.text).toContain('R100')
    expect(banner?.text).toContain('2 credits')
  })

  it('shows the sponsored banner without a follow-up ledger query', async () => {
    mockGetStatus.mockResolvedValue({
      outstandingCents: 0,
      lastReason: 'KYC_FEE_SPONSORED',
      lastAmountCents: 5000,
    })

    const { getProviderKycFeeBanner } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const banner = await getProviderKycFeeBanner()

    expect(banner).toMatchObject({ kind: 'sponsored' })
    expect(banner?.text).toContain('R50')
    expect(mockDb.kycFeeLedgerEntry.findFirst).not.toHaveBeenCalled()
  })

  it('still shows the accrued banner while the fee is outstanding', async () => {
    mockGetStatus.mockResolvedValue({
      outstandingCents: 5000,
      lastReason: 'KYC_FEE_ACCRUED',
      lastAmountCents: 5000,
    })

    const { getProviderKycFeeBanner } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const banner = await getProviderKycFeeBanner()

    expect(banner).toMatchObject({ kind: 'accrued' })
    expect(banner?.text).toContain('R50')
  })
})
