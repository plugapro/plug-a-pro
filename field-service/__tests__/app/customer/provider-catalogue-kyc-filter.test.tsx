// Defense-in-depth: customer-facing provider listing must filter on
// kycStatus explicitly, not rely on the transitive guarantee that provider
// approval (verified=true / status=ACTIVE) refuses to set verified without
// VERIFIED KYC (PR #114). If a future change weakens the approval pipeline
// or the provider.kyc.required_for_activation flag is OFF in some env, the
// customer surface must still hide non-VERIFIED providers.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockIsEnabled,
  mockProviderFindMany,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockProviderFindMany: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findMany: mockProviderFindMany,
    },
  },
}))

describe('customer provider catalogue — explicit kycStatus filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockProviderFindMany.mockResolvedValue([])
    mockIsEnabled.mockImplementation(async (flag: string) => {
      if (flag === 'feature.customer.provider_browse') return true
      // legacy grace OFF by default
      return false
    })
  })

  it('requires kycStatus=VERIFIED when the legacy KYC grace flag is OFF', async () => {
    const Page = (await import('@/app/(customer)/providers/page')).default

    await Page({
      searchParams: Promise.resolve({
        area: 'gauteng__johannesburg__jhb_west__little_falls',
      }),
    })

    expect(mockProviderFindMany).toHaveBeenCalledTimes(1)
    const args = mockProviderFindMany.mock.calls[0]?.[0]
    expect(args).toBeDefined()
    // The legacy transitive guard (verified=true / status=ACTIVE) is preserved.
    expect(args.where).toMatchObject({
      active: true,
      verified: true,
      status: 'ACTIVE',
    })
    // Defense-in-depth: explicit kycStatus filter on the same where clause.
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kycStatus: 'VERIFIED' }),
      ]),
    )
  })

  it('admits the legacy cohort via grace OR when matching.kyc_grace_legacy_providers is ON', async () => {
    mockIsEnabled.mockImplementation(async (flag: string) => {
      if (flag === 'feature.customer.provider_browse') return true
      if (flag === 'matching.kyc_grace_legacy_providers') return true
      return false
    })

    const Page = (await import('@/app/(customer)/providers/page')).default

    await Page({
      searchParams: Promise.resolve({
        area: 'gauteng__johannesburg__jhb_west__little_falls',
      }),
    })

    const args = mockProviderFindMany.mock.calls[0]?.[0]
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            { kycStatus: 'VERIFIED' },
            expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({ createdAt: { lt: expect.any(Date) } }),
                expect.objectContaining({
                  kycStatus: { notIn: expect.arrayContaining(['REJECTED', 'EXPIRED']) },
                }),
              ]),
            }),
          ]),
        }),
      ]),
    )
  })
})
