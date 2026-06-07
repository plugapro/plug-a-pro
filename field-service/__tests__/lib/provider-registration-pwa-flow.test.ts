import { describe, expect, it, vi } from 'vitest'
import {
  saveProviderRegistrationDraft,
  submitProviderRegistrationApplication,
} from '@/lib/provider-registration/pwa-flow'

function createDraftClient() {
  return {
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
      profilePhotoUrl: 'https://blob.example/photo.jpg',
      skills: ['plumbing'],
      serviceAreas: ['Maboneng'],
      locationNodeIds: ['sub_maboneng'],
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
        profilePhotoUrl: 'https://blob.example/photo.jpg',
        skills: ['plumbing'],
        categorySlugs: ['plumbing'],
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
      experience: '3-5 years',
      availability: 'Weekdays',
      callOutFee: 150,
      emergencyAvailable: true,
      profilePhotoUrl: 'https://blob.example/profile-photo.png',
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
        avatarUrl: 'https://blob.example/profile-photo.png',
      }),
    }))
    expect(tx.providerApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '+27823035070',
        email: 'thabo@example.com',
        name: 'Thabo Nkosi',
        skills: ['plumbing'],
        serviceAreas: ['Maboneng'],
        status: 'PENDING',
      }),
    }))
    expect(tx.providerCategory.createMany).toHaveBeenCalledOnce()
    expect(tx.providerRate.createMany).toHaveBeenCalledOnce()
    expect(tx.providerApplicationDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { submittedApplicationId: 'app-1', lastCompletedStep: 8 },
    })
  })
})
