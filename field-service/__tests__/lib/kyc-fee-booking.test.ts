import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('../../lib/db', () => ({ db: { $transaction: vi.fn() } }))

import {
  bookKycFeeForVerifiedProvider,
  type KycFeeBookingClient,
} from '../../lib/kyc-fee/booking'

type FakeOverrides = {
  existingAccrual?: boolean
  identifierHash?: string | null
  campaigns?: Array<Record<string, unknown>>
  identifierAlreadySponsored?: boolean
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
      findFirst: vi
        .fn()
        .mockResolvedValue(o.identifierAlreadySponsored ? { id: 'sp-old' } : null),
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
    expect(result.outcome).toBe('ACCRUED')
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
    expect(raw.kycCampaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'camp-1', status: 'ACTIVE' }),
      }),
    )
    expect(raw.kycSponsorship.create).toHaveBeenCalled()
  })

  it('falls back to accrual when the atomic claim loses (allocation exhausted)', async () => {
    const { client, ledgerWrites, raw } = makeClient({
      campaigns: [westRandCampaign],
      claimCount: 0,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ACCRUED')
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
    expect(raw.kycSponsorship.create).not.toHaveBeenCalled()
  })

  it('refuses a second sponsorship for the same verified identity', async () => {
    const { client, ledgerWrites } = makeClient({
      campaigns: [westRandCampaign],
      identifierAlreadySponsored: true,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ACCRUED')
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
  })
})
