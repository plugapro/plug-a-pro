import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

describe('provider lead access tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-provider-lead-secret'
    process.env.PROVIDER_LEAD_APP_URL = 'https://app.plugapro.co.za'
  })

  it('builds a signed lead access URL on the configured provider lead host', async () => {
    const { getProviderLeadAccessUrl, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')

    const url = await getProviderLeadAccessUrl({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/leads\/access\//)
    const token = decodeURIComponent(url!.split('/leads/access/')[1])
    const verified = verifyProviderLeadAccessToken(token)
    expect(verified).toMatchObject({
      status: 'active',
      payload: { leadId: 'lead-1', providerId: 'provider-1' },
    })
  })

  it('rejects tampered tokens', async () => {
    const { createProviderLeadAccessToken, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    const [payload, signature] = token.split('.')
    const tampered = `${payload}x.${signature}`

    expect(verifyProviderLeadAccessToken(tampered).status).toBe('invalid')
  })

  it('rejects expired tokens', async () => {
    const { createProviderLeadAccessToken, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const pastExpiry = new Date(Date.now() - 1000)
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1', expiresAt: pastExpiry })

    expect(verifyProviderLeadAccessToken(token).status).toBe('expired')
  })

  it('resolves only when the token provider matches the lead provider', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValue({ id: 'lead-1', providerId: 'provider-2' })

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
  })
})
