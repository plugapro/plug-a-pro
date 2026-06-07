import { describe, expect, it, vi } from 'vitest'
import {
  ProviderRegistrationValidationError,
  saveProviderRegistrationDraft,
  submitProviderRegistrationApplication,
} from '@/lib/provider-registration/pwa-flow'

function structuredSuburbRows(ids = ['sub_maboneng']) {
  return ids.map((id, index) => ({
    id,
    nodeType: 'SUBURB',
    slug: `gauteng__johannesburg__jhb_central__${id.replace(/^sub_/, '')}`,
    label: index === 0 ? 'Maboneng' : `Suburb ${index + 1}`,
    postalCode: '2094',
    provinceKey: 'gauteng',
    cityKey: 'johannesburg',
    regionKey: 'jhb_central',
    parent: {
      id: 'region-jhb-central',
      nodeType: 'REGION',
      label: 'JHB Central',
      parent: {
        id: 'city-johannesburg',
        nodeType: 'CITY',
        label: 'Johannesburg',
        parent: {
          id: 'province-gauteng',
          nodeType: 'PROVINCE',
          label: 'Gauteng',
        },
      },
    },
  }))
}

function createDraftClient() {
  return {
    locationNode: {
      findMany: vi.fn().mockResolvedValue(structuredSuburbRows()),
    },
    providerApplicationDraft: {
      create: vi.fn().mockResolvedValue({ id: 'draft-1' }),
      update: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    },
    registrationResumeToken: {
      create: vi.fn().mockResolvedValue({ id: 'token-1' }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  }
}

function createSubmitClient() {
  const tx = {
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    provider: {
      findUnique: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    providerApplication: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    },
    providerApplicationDraft: {
      update: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    },
    registrationResumeToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    locationNode: {
      findMany: vi.fn().mockResolvedValue(structuredSuburbRows()),
    },
    technicianServiceArea: {
      upsert: vi.fn().mockResolvedValue({ id: 'area-1' }),
    },
    providerCategory: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    providerRate: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }

  return {
    tx,
    client: {
      locationNode: {
        findMany: vi.fn().mockResolvedValue(structuredSuburbRows()),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  }
}

describe('provider registration PWA flow', () => {
  it('saves a draft and only persists a hashed resume token', async () => {
    const client = createDraftClient()

    const result = await saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      businessName: 'Nkosi Plumbing',
      preferredContact: 'WHATSAPP',
      identityBasis: 'SA_ID',
      profilePhotoUrl: 'https://store.public.blob.vercel-storage.com/photo.jpg',
      skills: ['plumbing'],
      serviceAreas: ['Maboneng'],
      locationNodeIds: ['sub_maboneng'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      travelRadiusKm: 25,
      lastCompletedStep: 2,
    })

    expect(result).toEqual({ draftId: 'draft-1', resumeToken: expect.any(String) })
    expect(client.providerApplicationDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '+27823035070',
        name: 'Thabo Nkosi',
        businessName: 'Nkosi Plumbing',
        preferredContact: 'WHATSAPP',
        identityBasis: 'SA_ID',
        profilePhotoUrl: 'https://store.public.blob.vercel-storage.com/photo.jpg',
        skills: ['plumbing'],
        categorySlugs: ['plumbing'],
        serviceAreas: ['Maboneng'],
        locationNodeIds: ['sub_maboneng'],
        travelRadiusKm: 25,
      }),
    }))
    expect(client.registrationResumeToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        draftId: 'draft-1',
        tokenHash: expect.any(String),
        purpose: 'provider_registration_resume',
      }),
    }))
    const tokenHash = client.registrationResumeToken.create.mock.calls[0][0].data.tokenHash
    expect(tokenHash).not.toContain(result.resumeToken)
  })

  it('creates a fresh draft when the stored draft id has no valid resume token', async () => {
    const client = createDraftClient()

    const result = await saveProviderRegistrationDraft(client, {
      draftId: 'missing-draft',
      resumeToken: 'expired-or-stale-token',
      phone: '082 303 5070',
      lastCompletedStep: 1,
    })

    expect(client.registrationResumeToken.findUnique).toHaveBeenCalledOnce()
    expect(client.providerApplicationDraft.update).not.toHaveBeenCalled()
    expect(client.providerApplicationDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '+27823035070',
        lastCompletedStep: 1,
      }),
    }))
    expect(result).toEqual({ draftId: 'draft-1', resumeToken: expect.any(String) })
    expect(result.resumeToken).not.toBe('expired-or-stale-token')
  })

  it('rejects typed-only service areas once the area step is completed', async () => {
    const client = createDraftClient()

    await expect(saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      serviceAreas: ['Roodport'],
      lastCompletedStep: 4,
    })).rejects.toMatchObject({
      code: 'STRUCTURED_SERVICE_AREA_REQUIRED',
    })

    expect(client.providerApplicationDraft.create).not.toHaveBeenCalled()
  })

  it('derives service area labels from selected canonical suburb nodes', async () => {
    const client = createDraftClient()

    await saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      serviceAreas: ['Roodport'],
      locationNodeIds: ['sub_maboneng'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      lastCompletedStep: 4,
    })

    expect(client.providerApplicationDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serviceAreas: ['Maboneng'],
        locationNodeIds: ['sub_maboneng'],
      }),
    }))
  })

  it('rejects selected suburbs that do not belong to the submitted hierarchy', async () => {
    const client = createDraftClient()

    await expect(saveProviderRegistrationDraft(client, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      locationNodeIds: ['sub_maboneng'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-roodepoort',
      lastCompletedStep: 4,
    })).rejects.toBeInstanceOf(ProviderRegistrationValidationError)
  })

  it('requires the selected parent hierarchy with submitted suburb node ids', async () => {
    const { client, tx } = createSubmitClient()

    await expect(submitProviderRegistrationApplication(client as any, {
      draftId: 'draft-1',
      resumeToken: 'resume-token',
      phone: '0823035070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      locationNodeIds: ['sub_maboneng'],
      availabilityDays: ['Mon'],
      callOutFee: 150,
      consentAccepted: true,
    })).rejects.toMatchObject({
      code: 'INVALID_LOCATION_HIERARCHY',
    })

    expect(tx.providerApplication.create).not.toHaveBeenCalled()
  })

  it('submits a draft as a linked pending provider application', async () => {
    const { client, tx } = createSubmitClient()

    const result = await submitProviderRegistrationApplication(client as any, {
      draftId: 'draft-1',
      resumeToken: 'resume-token',
      phone: '0823035070',
      name: 'Thabo Nkosi',
      email: 'thabo@example.com',
      skills: ['plumbing'],
      serviceAreas: ['Maboneng'],
      locationNodeIds: ['sub_maboneng'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      experience: '3-5 years',
      availability: 'Weekdays',
      availabilityDays: ['Sat', 'Sun'],
      callOutFee: 150,
      emergencyAvailable: true,
      profilePhotoUrl: 'https://store.public.blob.vercel-storage.com/profile-photo.png',
      consentAccepted: true,
    })

    expect(result).toEqual({ outcome: 'created', applicationId: 'app-1', ref: 'APP-1' })
    expect(tx.provider.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '+27823035070',
        name: 'Thabo Nkosi',
        active: false,
        verified: false,
        status: 'APPLICATION_PENDING',
        avatarUrl: 'https://store.public.blob.vercel-storage.com/profile-photo.png',
      }),
    }))
    expect(tx.providerApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '+27823035070',
        email: 'thabo@example.com',
        name: 'Thabo Nkosi',
        skills: ['plumbing'],
        serviceAreas: ['Maboneng'],
        weekendJobs: true,
        status: 'PENDING',
      }),
    }))
    expect(tx.providerCategory.createMany).toHaveBeenCalledOnce()
    expect(tx.providerRate.createMany).toHaveBeenCalledOnce()
    expect(tx.providerApplicationDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { submittedApplicationId: 'app-1', lastCompletedStep: 8 },
    })
    expect(tx.technicianServiceArea.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        providerId_locationNodeId: {
          providerId: expect.any(String),
          locationNodeId: 'sub_maboneng',
        },
      },
      create: expect.objectContaining({
        locationNodeId: 'sub_maboneng',
        areaType: 'SUBURB',
        label: 'Maboneng',
      }),
    }))
  })

  it('rejects submit payloads that only contain free-text service areas', async () => {
    const { client, tx } = createSubmitClient()

    await expect(submitProviderRegistrationApplication(client as any, {
      draftId: 'draft-1',
      resumeToken: 'resume-token',
      phone: '0823035070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      serviceAreas: ['Roodport'],
      availabilityDays: ['Mon'],
      callOutFee: 150,
      consentAccepted: true,
    })).rejects.toMatchObject({
      code: 'STRUCTURED_SERVICE_AREA_REQUIRED',
    })

    expect(tx.providerApplication.create).not.toHaveBeenCalled()
  })

  it('drops untrusted external profile photo URLs before persistence', async () => {
    const draftClient = createDraftClient()

    await saveProviderRegistrationDraft(draftClient, {
      phone: '082 303 5070',
      name: 'Thabo Nkosi',
      profilePhotoUrl: 'https://tracker.example.invalid/avatar.png',
      lastCompletedStep: 2,
    })

    expect(draftClient.providerApplicationDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        profilePhotoUrl: null,
      }),
    }))

    const { client, tx } = createSubmitClient()
    await submitProviderRegistrationApplication(client as any, {
      draftId: 'draft-1',
      resumeToken: 'resume-token',
      phone: '0823035070',
      name: 'Thabo Nkosi',
      skills: ['plumbing'],
      serviceAreas: ['Maboneng'],
      locationNodeIds: ['sub_maboneng'],
      provinceId: 'province-gauteng',
      cityId: 'city-johannesburg',
      regionId: 'region-jhb-central',
      availabilityDays: ['Mon'],
      callOutFee: 150,
      profilePhotoUrl: 'https://tracker.example.invalid/avatar.png',
      consentAccepted: true,
    })

    expect(tx.provider.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        avatarUrl: 'https://tracker.example.invalid/avatar.png',
      }),
    }))
  })
})
