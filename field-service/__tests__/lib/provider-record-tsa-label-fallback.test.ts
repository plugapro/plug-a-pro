import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
// Neutralise the KYC gate so verified:true is allowed in the test.
vi.mock('@/lib/kyc-policy', () => ({ isKycRequiredForActivation: vi.fn().mockResolvedValue(false) }))

import { syncProviderRecord } from '@/lib/provider-record'

function makeClient() {
  const upserts: any[] = []
  return {
    upserts,
    provider: {
      findUnique: vi.fn().mockResolvedValue(null),           // force create path
      updateMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    technicianServiceArea: {
      upsert: vi.fn((args: any) => { upserts.push(args); return Promise.resolve({}) }),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    technicianSkill: { upsert: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
    technicianAvailability: { upsert: vi.fn().mockResolvedValue({}) },
    locationNode: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'n-roode', nodeType: 'SUBURB', label: 'Roodepoort', slug: 'gauteng__johannesburg__jhb_west__roodepoort', regionKey: 'jhb_west', provinceKey: 'gauteng', cityKey: 'johannesburg' },
      ]),
    },
  }
}

const baseInput = {
  phone: '+27820000000', name: 'Test Provider', skills: ['plumbing'],
  serviceAreas: ['Roodepoort'], active: true, availableNow: true, verified: true,
}

describe('syncProviderRecord legacy-label TSA fallback', () => {
  beforeEach(() => { mockIsEnabled.mockReset() })

  it('creates TSA rows from serviceAreas labels when flag ON and no locationNodeIds', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const client = makeClient()
    await syncProviderRecord(client as any, baseInput)
    expect(client.technicianServiceArea.upsert).toHaveBeenCalledTimes(1)
    expect(client.upserts[0].create.locationNodeId).toBe('n-roode')
  })

  it('does NOT create TSA rows from labels when flag OFF', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const client = makeClient()
    await syncProviderRecord(client as any, baseInput)
    expect(client.technicianServiceArea.upsert).not.toHaveBeenCalled()
  })
})
