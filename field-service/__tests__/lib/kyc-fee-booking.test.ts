import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('../../lib/db', () => ({ db: { $transaction: vi.fn() } }))

import {
  bookKycFeeForVerifiedProvider,
  KycFeeBookingError,
  type KycFeeBookingClient,
} from '../../lib/kyc-fee/booking'
import { KYC_FEE_CENTS } from '../../lib/kyc-fee/constants'

type FakeOverrides = {
  existingAccrual?: boolean
  identifierHash?: string | null
  campaigns?: Array<Record<string, unknown>>
  identifierAlreadySponsored?: boolean
  alreadySponsoredOnCampaign?: boolean
  claimCount?: number
  tsaMatch?: boolean
}

function makeClient(o: FakeOverrides = {}) {
  const ledgerWrites: Array<Record<string, unknown>> = []
  let ledgerBalance: { balanceAfterCents: number } | null = null
  const client = {
    kycFeeLedgerEntry: {
      findUnique: vi.fn().mockResolvedValue(o.existingAccrual ? { id: 'led-0' } : null),
      findFirst: vi.fn().mockImplementation(async () => ledgerBalance),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        ledgerWrites.push(data)
        ledgerBalance = { balanceAfterCents: data.balanceAfterCents as number }
        return { id: `led-${ledgerWrites.length}`, ...data }
      }),
    },
    providerIdentityVerification: {
      findUnique: vi.fn().mockResolvedValue({
        identifierHash: o.identifierHash === undefined ? 'hash-1' : o.identifierHash,
      }),
    },
    kycCampaign: {
      findMany: vi.fn().mockResolvedValue(o.campaigns ?? []),
      updateMany: vi.fn().mockResolvedValue({ count: o.claimCount ?? 1 }),
    },
    kycSponsorship: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.identifierHash) {
          return o.identifierAlreadySponsored ? { id: 'sp-old' } : null
        }
        return o.alreadySponsoredOnCampaign ? { id: 'sp-camp' } : null
      }),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'sp-1',
        ...data,
      })),
    },
    technicianServiceArea: {
      findFirst: vi.fn().mockResolvedValue(o.tsaMatch === false ? null : { id: 'tsa-1' }),
    },
    provider: {
      findUnique: vi.fn().mockResolvedValue({ serviceAreas: [] }),
    },
  }
  return { client: client as unknown as KycFeeBookingClient, ledgerWrites, raw: client }
}

const input = { providerId: 'provider-1', verificationId: 'verif-1' }

const westRandCampaign = {
  id: 'camp-1',
  campaignCode: 'WEST_RAND_LAUNCH',
  status: 'ACTIVE',
  sponsoredCount: 10,
  maxSponsoredCount: 200,
  locationNode: { nodeType: 'REGION', slug: 'gauteng__johannesburg__jhb_west' },
}

describe('bookKycFeeForVerifiedProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
  })

  it('is a no-op when the fee accrual flag is off', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const { client, ledgerWrites } = makeClient()
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('FLAG_OFF')
    expect(ledgerWrites).toHaveLength(0)
  })

  it('is idempotent when an accrual already exists', async () => {
    const { client, ledgerWrites } = makeClient({ existingAccrual: true })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ALREADY_BOOKED')
    expect(ledgerWrites).toHaveLength(0)
  })

  it('accrues the fee when no campaign is eligible', async () => {
    const { client, ledgerWrites } = makeClient({ campaigns: [] })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result).toMatchObject({ outcome: 'ACCRUED', skippedSponsorship: 'NO_ELIGIBLE_CAMPAIGN' })
    expect(ledgerWrites).toHaveLength(1)
    expect(ledgerWrites[0].reason).toBe('KYC_FEE_ACCRUED')
  })

  it('sponsors the fee when an area-matched campaign has allocation', async () => {
    const { client, ledgerWrites, raw } = makeClient({ campaigns: [westRandCampaign] })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('SPONSORED')
    expect(ledgerWrites.map((w) => w.reason)).toEqual([
      'KYC_FEE_ACCRUED',
      'KYC_FEE_SPONSORED',
    ])
    expect(ledgerWrites[1].balanceAfterCents).toBe(0)
    expect(raw.kycCampaign.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'camp-1',
        status: 'ACTIVE',
        sponsoredCount: { lt: 200 },
      },
      data: { sponsoredCount: { increment: 1 } },
    })
    expect(raw.kycSponsorship.create).toHaveBeenCalledWith({
      data: {
        campaignId: 'camp-1',
        providerId: 'provider-1',
        verificationId: 'verif-1',
        identifierHash: 'hash-1',
        status: 'CONSUMED',
        source: 'system',
        feeCents: KYC_FEE_CENTS,
      },
    })
    expect(result).toMatchObject({
      outcome: 'SPONSORED',
      campaignId: 'camp-1',
      campaignCode: 'WEST_RAND_LAUNCH',
      sponsorshipId: 'sp-1',
    })
  })

  it('falls back to accrual when the atomic claim loses (allocation exhausted)', async () => {
    const { client, ledgerWrites, raw } = makeClient({
      campaigns: [westRandCampaign],
      claimCount: 0,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result).toMatchObject({ outcome: 'ACCRUED', skippedSponsorship: 'ALLOCATION_EXHAUSTED' })
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
    expect(raw.kycSponsorship.create).not.toHaveBeenCalled()
  })

  it('refuses a second sponsorship for the same verified identity', async () => {
    const { client, ledgerWrites } = makeClient({
      campaigns: [westRandCampaign],
      identifierAlreadySponsored: true,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result).toMatchObject({ outcome: 'ACCRUED', skippedSponsorship: 'IDENTIFIER_ALREADY_SPONSORED' })
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
  })

  it('skips sponsorship when this campaign already sponsored the provider (manual grant)', async () => {
    const { client, ledgerWrites, raw } = makeClient({
      campaigns: [westRandCampaign],
      alreadySponsoredOnCampaign: true,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result).toMatchObject({
      outcome: 'ACCRUED',
      skippedSponsorship: 'ALREADY_SPONSORED_ON_CAMPAIGN',
    })
    expect(raw.kycCampaign.updateMany).not.toHaveBeenCalled()
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
  })

  it('throws loudly when the verification row is missing', async () => {
    const { client, ledgerWrites, raw } = makeClient()
    ;(raw.providerIdentityVerification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(bookKycFeeForVerifiedProvider(input, client)).rejects.toMatchObject({
      name: 'KycFeeBookingError',
      code: 'VERIFICATION_NOT_FOUND',
    })
    expect(ledgerWrites).toHaveLength(0)
  })

  it('sponsors without identity dedup when the verification has no identifier hash', async () => {
    const { client, raw } = makeClient({
      campaigns: [westRandCampaign],
      identifierHash: null,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('SPONSORED')
    expect(raw.kycSponsorship.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ identifierHash: expect.anything() }) }),
    )
    expect(raw.kycSponsorship.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ identifierHash: null }) }),
    )
  })
})
