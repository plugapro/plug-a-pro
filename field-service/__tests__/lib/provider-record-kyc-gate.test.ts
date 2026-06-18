// syncProviderRecord must consult the KYC approval gate when mandatory KYC is
// ON. The gate itself is unit-tested in provider-lead-eligibility.test.ts;
// these tests prove the wiring: when the gate denies, syncProviderRecord
// downgrades the write to verified=false / status=APPLICATION_PENDING and
// records the reason, instead of silently flipping a non-KYC provider to ACTIVE.

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { syncProviderRecord } from '@/lib/provider-record'

vi.mock('@/lib/kyc-policy', () => ({
  isKycRequiredForActivation: vi.fn(),
  KYC_REQUIRED_FLAG: 'provider.kyc.required_for_activation',
  KYC_EXISTING_PROVIDER_GRACE_DAYS: 30,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: vi.fn().mockResolvedValue(false),
}))

import { isKycRequiredForActivation } from '@/lib/kyc-policy'
import { isEnabled } from '@/lib/flags'

const mockedKycRequired = vi.mocked(isKycRequiredForActivation)
const mockedIsEnabled = vi.mocked(isEnabled)

function makeClient(opts: {
  existing?: {
    id: string
    kycStatus?: string
    createdAt?: Date | null
    kycGraceUntil?: Date | null
    kycOverriddenAt?: Date | null
  } | null
} = {}) {
  return {
    provider: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    technicianSkill: {
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    technicianAvailability: {
      upsert: vi.fn(),
    },
  }
}

beforeEach(() => {
  mockedKycRequired.mockReset()
  mockedIsEnabled.mockReset()
  mockedIsEnabled.mockResolvedValue(false)
})

describe('syncProviderRecord — KYC gate (flag OFF)', () => {
  it('writes verified=true / status=ACTIVE unchanged (backwards compatible)', async () => {
    mockedKycRequired.mockResolvedValue(false)
    const client = makeClient({
      existing: { id: 'prov_legacy', kycStatus: 'NOT_STARTED' },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Legacy Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov_legacy' },
      data: expect.objectContaining({ verified: true, status: 'ACTIVE' }),
    })
  })
})

describe('syncProviderRecord — KYC gate (flag ON)', () => {
  beforeEach(() => {
    mockedKycRequired.mockResolvedValue(true)
  })

  it('downgrades verified=true → verified=false when provider has NOT_STARTED KYC', async () => {
    const client = makeClient({
      existing: {
        id: 'prov_new',
        kycStatus: 'NOT_STARTED',
        createdAt: new Date('2026-08-01T00:00:00.000Z'), // post-cutoff
      },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'New Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    const call = client.provider.updateMany.mock.calls[0][0]
    expect(call.data.verified).toBe(false)
    expect(call.data.status).toBe('APPLICATION_PENDING')
    expect(call.data.active).toBe(false)
  })

  it('honors per-provider grace window — still writes verified=true', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const client = makeClient({
      existing: {
        id: 'prov_grace',
        kycStatus: 'NOT_STARTED',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        kycGraceUntil: future,
      },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Graced Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    const call = client.provider.updateMany.mock.calls[0][0]
    expect(call.data.verified).toBe(true)
    expect(call.data.status).toBe('ACTIVE')
  })

  it('honors VERIFIED — still writes verified=true', async () => {
    const client = makeClient({
      existing: {
        id: 'prov_verified',
        kycStatus: 'VERIFIED',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Verified Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    const call = client.provider.updateMany.mock.calls[0][0]
    expect(call.data.verified).toBe(true)
    expect(call.data.status).toBe('ACTIVE')
  })

  it('honors admin override — still writes verified=true', async () => {
    const client = makeClient({
      existing: {
        id: 'prov_override',
        kycStatus: 'NOT_STARTED',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        kycOverriddenAt: new Date('2026-06-18T00:00:00.000Z'),
      },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Overridden Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    const call = client.provider.updateMany.mock.calls[0][0]
    expect(call.data.verified).toBe(true)
  })

  it('honors legacy cohort grace (pre-cutoff createdAt) when grace flag is ON', async () => {
    mockedIsEnabled.mockImplementation(async (key) =>
      key === 'matching.kyc_grace_legacy_providers',
    )
    const client = makeClient({
      existing: {
        id: 'prov_legacy_grandfathered',
        kycStatus: 'NOT_STARTED',
        createdAt: new Date('2026-05-01T00:00:00.000Z'), // pre-cutoff
      },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Pre-cutoff Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    const call = client.provider.updateMany.mock.calls[0][0]
    expect(call.data.verified).toBe(true)
  })

  it('blocks even legacy provider with REJECTED kycStatus', async () => {
    mockedIsEnabled.mockImplementation(async (key) =>
      key === 'matching.kyc_grace_legacy_providers',
    )
    const client = makeClient({
      existing: {
        id: 'prov_legacy_rejected',
        kycStatus: 'REJECTED',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    })

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Rejected Legacy Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    const call = client.provider.updateMany.mock.calls[0][0]
    expect(call.data.verified).toBe(false)
    expect(call.data.status).toBe('APPLICATION_PENDING')
  })

  it('new provider: createMany also downgrades when KYC missing', async () => {
    const client = makeClient({ existing: null })

    await syncProviderRecord(client as never, {
      phone: '+27821234999',
      name: 'Brand New Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Cape Town'],
      active: true,
      availableNow: true,
      verified: true,
      skipEnrichment: true,
    })

    expect(client.provider.createMany).toHaveBeenCalled()
    const call = client.provider.createMany.mock.calls[0][0]
    expect(call.data.verified).toBe(false)
    expect(call.data.status).toBe('APPLICATION_PENDING')
    expect(call.data.active).toBe(false)
  })
})
