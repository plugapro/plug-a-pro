import { describe, it, expect, vi } from 'vitest'

import { reconcileProviderRecordsFromApplications } from '@/lib/provider-record'

function makeClient() {
  return {
    provider: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    providerApplication: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

describe('reconcileProviderRecordsFromApplications', () => {
  it('creates provider records for pending applications and links them back', async () => {
    const client = makeClient()
    client.providerApplication.findMany.mockResolvedValue([
      {
        id: 'app_pending',
        phone: '+27799887766',
        name: 'Bongani Nkosi',
        skills: ['Plumbing', 'Tiling'],
        serviceAreas: ['Randburg', 'Roodepoort'],
        status: 'PENDING',
        providerId: null,
      },
    ])
    client.provider.findUnique.mockResolvedValue(null)
    client.provider.createMany.mockResolvedValue({ count: 1 })
    client.providerApplication.updateMany.mockResolvedValue({ count: 1 })

    const result = await reconcileProviderRecordsFromApplications(client as never)

    expect(result).toEqual({ reconciled: 1 })
    expect(client.provider.createMany).toHaveBeenCalledOnce()
    expect(client.provider.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '+27799887766',
          verified: false,
          active: true,
          availableNow: true,
        }),
      }),
    )
    expect(client.providerApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app_pending' },
      data: { providerId: expect.any(String) },
    })
  })

  it('upgrades approved applications to verified providers before linking them back', async () => {
    const client = makeClient()
    client.providerApplication.findMany.mockResolvedValue([
      {
        id: 'app_approved',
        phone: '+27788776655',
        name: 'Fatima Cassim',
        skills: ['Electrical'],
        serviceAreas: ['Centurion'],
        status: 'APPROVED',
        providerId: null,
      },
    ])
    client.provider.findUnique.mockResolvedValue({ id: 'provider_existing' })
    client.provider.updateMany.mockResolvedValue({ count: 1 })
    client.providerApplication.updateMany.mockResolvedValue({ count: 1 })

    const result = await reconcileProviderRecordsFromApplications(client as never)

    expect(result).toEqual({ reconciled: 1 })
    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'provider_existing' },
      data: expect.objectContaining({
        name: 'Fatima Cassim',
        verified: true,
        active: true,
        availableNow: true,
      }),
    })
    expect(client.providerApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app_approved' },
      data: { providerId: 'provider_existing' },
    })
  })
})
