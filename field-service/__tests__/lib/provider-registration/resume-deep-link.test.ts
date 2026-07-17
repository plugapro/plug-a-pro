import { describe, expect, it, vi } from 'vitest'
import { resolveResumeTokenDraft } from '@/lib/provider-registration/pwa-flow'

function client(token: any, draft: any) {
  return {
    registrationResumeToken: { findUnique: vi.fn().mockResolvedValue(token) },
    providerApplicationDraft: { findUnique: vi.fn().mockResolvedValue(draft) },
  } as any // TODO: fake client for unit test
}

const liveToken = {
  draftId: 'd1',
  purpose: 'provider_registration_resume',
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
}
const draft = { id: 'd1', phone: '+27820001111', lastCompletedStep: 6, submittedApplicationId: null }

describe('resolveResumeTokenDraft', () => {
  it('returns draft info for a valid token', async () => {
    const result = await resolveResumeTokenDraft(client(liveToken, draft), 'tok')
    expect(result).toEqual({ draftId: 'd1', phone: '+27820001111', lastCompletedStep: 6 })
  })

  it('returns null for expired, consumed, wrong-purpose, or unknown tokens', async () => {
    expect(await resolveResumeTokenDraft(client(null, draft), 'tok')).toBeNull()
    expect(await resolveResumeTokenDraft(client({ ...liveToken, consumedAt: new Date() }, draft), 'tok')).toBeNull()
    expect(await resolveResumeTokenDraft(client({ ...liveToken, expiresAt: new Date(Date.now() - 1) }, draft), 'tok')).toBeNull()
    expect(await resolveResumeTokenDraft(client({ ...liveToken, purpose: 'other' }, draft), 'tok')).toBeNull()
  })

  it('returns null when the draft is already submitted or gone', async () => {
    expect(await resolveResumeTokenDraft(client(liveToken, null), 'tok')).toBeNull()
    expect(
      await resolveResumeTokenDraft(client(liveToken, { ...draft, submittedApplicationId: 'app1' }), 'tok'),
    ).toBeNull()
  })

  it('returns null for empty token without querying', async () => {
    const c = client(liveToken, draft)
    expect(await resolveResumeTokenDraft(c, '')).toBeNull()
    expect(c.registrationResumeToken.findUnique).not.toHaveBeenCalled()
  })
})
