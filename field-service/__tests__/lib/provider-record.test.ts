import { describe, it, expect, vi } from 'vitest'

import { reconcileProviderRecordsFromApplications, syncProviderRecord } from '@/lib/provider-record'

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

  it('deduplicates same phone in two applications — both are linked to the same Provider id', async () => {
    // Two applications for the same phone, both unlinked (e.g. old data or race condition
    // before the partial unique index was applied). reconcile must link both to the same provider.
    const client = makeClient()
    client.providerApplication.findMany.mockResolvedValue([
      {
        id: 'app_first',
        phone: '+27711223344',
        name: 'Lungelo Dube',
        skills: ['Handyman'],
        serviceAreas: ['Sandton'],
        status: 'PENDING',
        providerId: null,
      },
      {
        id: 'app_second',
        phone: '+27711223344',
        name: 'Lungelo Dube',
        skills: ['Handyman', 'Plumbing'],
        serviceAreas: ['Sandton', 'Randburg'],
        status: 'PENDING',
        providerId: null,
      },
    ])

    // First call: provider does not exist yet → create
    // Second call: provider now exists → update
    client.provider.findUnique
      .mockResolvedValueOnce(null)                // first app — create
      .mockResolvedValueOnce({ id: 'provider_shared' })  // second app — update (same phone)
    client.provider.createMany.mockResolvedValue({ count: 1 })
    client.provider.updateMany.mockResolvedValue({ count: 1 })
    client.providerApplication.updateMany.mockResolvedValue({ count: 1 })

    const result = await reconcileProviderRecordsFromApplications(client as never)

    expect(result).toEqual({ reconciled: 2 })
    // Both applications are linked — second must receive the same provider id found by phone
    expect(client.providerApplication.updateMany).toHaveBeenCalledTimes(2)
    // The second application should be linked to the existing provider (found by phone lookup)
    const calls = (client.providerApplication.updateMany as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({ where: { id: 'app_first' } })
    expect(calls[1][0]).toMatchObject({ where: { id: 'app_second' }, data: { providerId: 'provider_shared' } })
  })
})

// ─── syncProviderRecord — phone normalization ─────────────────────────────────

describe('syncProviderRecord — phone normalization', () => {
  it('normalizes South African local format before lookup and create', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '0821234567',   // local format — must be stored as +27821234567
      name: 'Sipho Khumalo',
      skills: ['Electrical'],
      serviceAreas: ['Centurion'],
      active: true,
      availableNow: true,
      verified: false,
    })

    expect(client.provider.findUnique).toHaveBeenCalledWith({
      where: { phone: '+27821234567' },
      select: { id: true },
    })
    expect(client.provider.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: '+27821234567' }),
      })
    )
  })

  it('upserts existing provider record when phone already in E.164', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prov_exists' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn(),
      },
    }

    const id = await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Sipho Khumalo Updated',
      skills: ['Electrical', 'Plumbing'],
      serviceAreas: ['Centurion'],
      active: true,
      availableNow: false,
      verified: true,
    })

    expect(id).toBe('prov_exists')
    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov_exists' },
      data: expect.objectContaining({ verified: true, name: 'Sipho Khumalo Updated' }),
    })
    expect(client.provider.createMany).not.toHaveBeenCalled()
  })
})
