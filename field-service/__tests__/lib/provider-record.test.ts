import { describe, it, expect, vi } from 'vitest'

import { reconcileProviderRecordsFromApplications, syncProviderRecord } from '@/lib/provider-record'

function makeClient() {
  return {
    provider: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    technicianSkill: {
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    technicianAvailability: {
      upsert: vi.fn(),
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
        isTestUser: false,
        cohortName: null,
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
          active: false,
          availableNow: false,
          status: 'APPLICATION_PENDING',
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
        isTestUser: false,
        cohortName: null,
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
        status: 'ACTIVE',
      }),
    })
    expect(client.providerApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app_approved' },
      data: { providerId: 'provider_existing' },
    })
    expect(client.technicianAvailability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: 'provider_existing' },
        update: expect.objectContaining({
          availabilityMode: 'ALWAYS_AVAILABLE',
          availabilityState: 'AVAILABLE',
          emergencyAvailable: true,
          sameDayAvailable: true,
        }),
      }),
    )
  })

  it('repairs approved applications already linked to unverified providers', async () => {
    const client = makeClient()
    client.providerApplication.findMany.mockResolvedValue([
      {
        id: 'app_linked_approved',
        phone: '+27764010810',
        name: 'Seth plumber',
        skills: ['Plumbing'],
        serviceAreas: ['Bromhof'],
        status: 'APPROVED',
        providerId: 'provider_existing',
        isTestUser: false,
        cohortName: null,
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
        verified: true,
        active: true,
        availableNow: true,
        status: 'ACTIVE',
      }),
    })
    expect(client.providerApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app_linked_approved' },
      data: { providerId: 'provider_existing' },
    })
  })

  it('deduplicates same phone in two applications - both are linked to the same Provider id', async () => {
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
        isTestUser: false,
        cohortName: null,
      },
      {
        id: 'app_second',
        phone: '+27711223344',
        name: 'Lungelo Dube',
        skills: ['Handyman', 'Plumbing'],
        serviceAreas: ['Sandton', 'Randburg'],
        status: 'PENDING',
        providerId: null,
        isTestUser: false,
        cohortName: null,
      },
    ])

    // First call: provider does not exist yet → create
    // Second call: provider now exists → update
    client.provider.findUnique
      .mockResolvedValueOnce(null)                // first app - create
      .mockResolvedValueOnce({ id: 'provider_shared' })  // second app - update (same phone)
    client.provider.createMany.mockResolvedValue({ count: 1 })
    client.provider.updateMany.mockResolvedValue({ count: 1 })
    client.providerApplication.updateMany.mockResolvedValue({ count: 1 })

    const result = await reconcileProviderRecordsFromApplications(client as never)

    expect(result).toEqual({ reconciled: 2 })
    // Both applications are linked - second must receive the same provider id found by phone
    expect(client.providerApplication.updateMany).toHaveBeenCalledTimes(2)
    // The second application should be linked to the existing provider (found by phone lookup)
    const calls = (client.providerApplication.updateMany as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({ where: { id: 'app_first' } })
    expect(calls[1][0]).toMatchObject({ where: { id: 'app_second' }, data: { providerId: 'provider_shared' } })
  })

  it('repairs approved test-cohort applications whose provider row lost the cohort flags', async () => {
    const client = makeClient()
    client.providerApplication.findMany.mockResolvedValue([
      {
        id: 'app_test_approved',
        phone: '+27827000070',
        name: 'Fanie Masemola',
        skills: ['Handyman'],
        serviceAreas: ['Ruimsig'],
        status: 'APPROVED',
        providerId: 'provider_test',
        isTestUser: true,
        cohortName: 'internal_staff_test',
      },
    ])
    client.provider.findUnique.mockResolvedValue({ id: 'provider_test' })
    client.provider.updateMany.mockResolvedValue({ count: 1 })
    client.providerApplication.updateMany.mockResolvedValue({ count: 1 })

    const result = await reconcileProviderRecordsFromApplications(client as never)

    expect(result).toEqual({ reconciled: 1 })
    expect(client.providerApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: 'APPROVED',
              isTestUser: true,
              provider: { is: { isTestUser: false } },
            }),
          ]),
        }),
      }),
    )
    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'provider_test' },
      data: expect.objectContaining({
        isTestUser: true,
        cohortName: 'internal_staff_test',
        verified: true,
        active: true,
        availableNow: true,
      }),
    })
  })
})

// ─── syncProviderRecord - phone normalization ─────────────────────────────────

describe('syncProviderRecord - phone normalization', () => {
  it('normalizes South African local format before lookup and create', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '0821234567',   // local format - must be stored as +27821234567
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

  it('preserves explicit application cohort flags when syncing a provider', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prov_test' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn(),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '+27827000070',
      name: 'Fanie Masemola',
      skills: ['Handyman'],
      serviceAreas: ['Ruimsig'],
      active: true,
      availableNow: true,
      verified: true,
      isTestUser: true,
      cohortName: 'internal_staff_test',
    })

    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov_test' },
      data: expect.objectContaining({
        isTestUser: true,
        cohortName: 'internal_staff_test',
      }),
    })
  })

  it('syncs normalized technician skill tags while keeping provider skill labels', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prov_exists' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn(),
      },
      technicianSkill: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Sipho Khumalo',
      skills: ['Electrical', 'Garden & Landscaping', 'DIY & Assembly'],
      serviceAreas: ['Centurion'],
      active: true,
      availableNow: true,
      verified: false,
    })

    expect(client.technicianSkill.updateMany).toHaveBeenCalledWith({
      where: {
        providerId: 'prov_exists',
        skillTag: { notIn: ['electrical', 'garden', 'diy'] },
      },
      data: { active: false },
    })
    expect(client.technicianSkill.upsert).toHaveBeenCalledTimes(3)
    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov_exists' },
      data: expect.objectContaining({
        skills: ['Electrical', 'Garden & Landscaping', 'DIY & Assembly'],
      }),
    })
  })
})

describe('syncProviderRecord - pilot service-area activation', () => {
  it('marks JHB West / Roodepoort structured coverage active', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prov_exists' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn(),
      },
      technicianSkill: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      technicianServiceArea: {
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sub_roodepoort',
            nodeType: 'SUBURB',
            slug: 'gauteng__johannesburg__jhb_west__roodepoort',
            label: 'Roodepoort',
            provinceKey: 'gauteng',
            cityKey: 'johannesburg',
            regionKey: 'jhb_west',
          },
        ]),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Pilot Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Roodepoort'],
      active: true,
      availableNow: true,
      verified: false,
      locationNodeIds: ['sub_roodepoort'],
    })

    expect(client.technicianServiceArea.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: true, regionKey: 'jhb_west' }),
        update: expect.objectContaining({ active: true, regionKey: 'jhb_west' }),
      }),
    )
  })

  it('stores provider service areas and structured labels in display case', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      technicianSkill: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      technicianServiceArea: {
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sub_ruimsig',
            nodeType: 'SUBURB',
            slug: 'gauteng__johannesburg__jhb_west__ruimsig',
            label: 'ruimsig',
            provinceKey: 'gauteng',
            cityKey: 'johannesburg',
            regionKey: 'jhb_west',
          },
        ]),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Case Provider',
      skills: ['Handyman'],
      serviceAreas: ['ruimsig', 'greenstone hill'],
      active: true,
      availableNow: true,
      verified: false,
      locationNodeIds: ['sub_ruimsig'],
    })

    expect(client.provider.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceAreas: ['Ruimsig', 'Greenstone Hill'] }),
      }),
    )
    expect(client.technicianServiceArea.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ label: 'Ruimsig' }),
        update: expect.objectContaining({ label: 'Ruimsig' }),
      }),
    )
  })

  it('marks non-pilot structured coverage coming soon and inactive for matching', async () => {
    const client = {
      provider: {
        findUnique: vi.fn().mockResolvedValue({ id: 'prov_exists' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn(),
      },
      technicianSkill: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      technicianServiceArea: {
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      locationNode: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sub_sandton',
            nodeType: 'SUBURB',
            slug: 'gauteng__johannesburg__jhb_north__sandton',
            label: 'Sandton',
            provinceKey: 'gauteng',
            cityKey: 'johannesburg',
            regionKey: 'jhb_north',
          },
        ]),
      },
    }

    await syncProviderRecord(client as never, {
      phone: '+27821234567',
      name: 'Coming Soon Provider',
      skills: ['Plumbing'],
      serviceAreas: ['Sandton'],
      active: true,
      availableNow: true,
      verified: false,
      locationNodeIds: ['sub_sandton'],
    })

    expect(client.technicianServiceArea.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: false, regionKey: 'jhb_north' }),
        update: expect.objectContaining({ active: false, regionKey: 'jhb_north' }),
      }),
    )
  })
})
