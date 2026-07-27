import { describe, expect, it, vi } from 'vitest'
import { saveProviderRegistrationDraft } from '@/lib/provider-registration/pwa-flow'

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    locationNode: { findMany: vi.fn().mockResolvedValue([]) },
    registrationResumeToken: {
      findUnique: vi.fn().mockResolvedValue(null), // no valid token by default
      create: vi.fn().mockResolvedValue({}),
    },
    providerApplicationDraft: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'new-draft' }),
    },
    ...overrides,
  } as any // TODO: fake client for DraftClient Pick; full PrismaClient typing not practical in unit tests
}

const baseInput = { phone: '+27821110000', lastCompletedStep: 2 } as any

describe('saveProviderRegistrationDraft phone fallback', () => {
  it('updates the newest un-submitted draft for the phone when the token is missing', async () => {
    const client = fakeClient()
    client.providerApplicationDraft.findFirst.mockResolvedValue({ id: 'existing-draft' })

    const result = await saveProviderRegistrationDraft(client, baseInput)

    expect(client.providerApplicationDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ phone: '+27821110000', submittedApplicationId: null }),
        orderBy: { updatedAt: 'desc' },
      }),
    )
    expect(client.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-draft' } }),
    )
    expect(client.providerApplicationDraft.create).not.toHaveBeenCalled()
    expect(result.draftId).toBe('existing-draft')
    expect(result.resumeToken).not.toBe('') // fresh token minted for the reused draft
    expect(client.registrationResumeToken.create).toHaveBeenCalled()
  })

  it('creates a draft only when neither token nor phone finds one', async () => {
    const client = fakeClient()
    const result = await saveProviderRegistrationDraft(client, baseInput)
    expect(client.providerApplicationDraft.create).toHaveBeenCalled()
    expect(result.draftId).toBe('new-draft')
  })

  it('still honours a valid resume token without touching the phone lookup', async () => {
    const client = fakeClient()
    client.registrationResumeToken.findUnique.mockResolvedValue({
      draftId: 'token-draft',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      draft: { phone: '+27821110000' },
    })
    const result = await saveProviderRegistrationDraft(client, { ...baseInput, resumeToken: 'tok' })
    expect(result.draftId).toBe('token-draft')
    expect(client.providerApplicationDraft.findFirst).not.toHaveBeenCalled()
  })

  it('ignores the token when its draft phone differs from the session-validated input phone, falling back to phone lookup', async () => {
    const client = fakeClient()
    // Token resolves to a draft belonging to a DIFFERENT phone number (e.g. a
    // resume link forwarded to someone else who then completes their own OTP).
    client.registrationResumeToken.findUnique.mockResolvedValue({
      draftId: 'token-draft-belongs-to-someone-else',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      draft: { phone: '+27829999999' },
    })
    client.providerApplicationDraft.findFirst.mockResolvedValue({ id: 'my-own-draft' })

    const result = await saveProviderRegistrationDraft(client, { ...baseInput, resumeToken: 'tok' })

    // Must NOT touch the mismatched token draft.
    expect(client.providerApplicationDraft.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'token-draft-belongs-to-someone-else' } }),
    )
    // Falls through to the phone-fallback lookup/update for the session-validated phone.
    expect(client.providerApplicationDraft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ phone: '+27821110000', submittedApplicationId: null }),
      }),
    )
    expect(client.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'my-own-draft' } }),
    )
    expect(result.draftId).toBe('my-own-draft')
    // A fresh token must be minted for the correct draft — the caller cannot
    // keep using the forwarded (mismatched) token.
    expect(result.resumeToken).not.toBe('')
    expect(result.resumeToken).not.toBe('tok')
    expect(client.registrationResumeToken.create).toHaveBeenCalled()
  })

  it('honours the token when its draft phone matches a variant of the session-validated input phone', async () => {
    const client = fakeClient()
    // Draft was saved with a local-format number; input phone is the E.164
    // normalized variant of the SAME underlying number.
    client.registrationResumeToken.findUnique.mockResolvedValue({
      draftId: 'token-draft',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      draft: { phone: '0821110000' },
    })

    const result = await saveProviderRegistrationDraft(client, { ...baseInput, phone: '+27821110000', resumeToken: 'tok' })

    expect(result.draftId).toBe('token-draft')
    expect(client.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'token-draft' } }),
    )
    expect(client.providerApplicationDraft.findFirst).not.toHaveBeenCalled()
  })

  it('recovers from a unique violation by re-finding and updating', async () => {
    const client = fakeClient()
    client.providerApplicationDraft.findFirst
      .mockResolvedValueOnce(null)                      // pre-create lookup: nothing
      .mockResolvedValueOnce({ id: 'race-winner' })      // post-violation re-find
    client.providerApplicationDraft.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    )
    const result = await saveProviderRegistrationDraft(client, baseInput)
    expect(result.draftId).toBe('race-winner')
    expect(client.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'race-winner' } }),
    )
  })
})
