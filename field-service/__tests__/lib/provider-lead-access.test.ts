import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    jobRequestId: 'job-request-1',
    status: 'SENT',
    sentAt: new Date('2026-04-29T10:00:00.000Z'),
    expiresAt: new Date('2026-04-29T11:00:00.000Z'),
    provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27820000000', active: true, status: 'ACTIVE' },
    unlock: null,
    jobRequest: {
      id: 'job-request-1',
      category: 'Plumbing',
      title: 'Leaking pipe',
      description: `${'Preview-safe notes. '.repeat(14)}Gate code 1234 and exact unit details after unlock.`,
      requestedWindowStart: null,
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
      customerAcceptedAmount: null,
      address: { suburb: 'Sandton', city: 'Johannesburg' },
      match: null,
    },
    ...overrides,
  }
}

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
      payload: {
        leadId: 'lead-1',
        providerId: 'provider-1',
        scopes: ['view_lead', 'unlock_lead', 'accept_lead', 'decline_lead'],
      },
    })
  })

  it('builds a scoped accepted-job handover URL', async () => {
    const { getProviderSignedJobHandoverUrl, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')

    const url = await getProviderSignedJobHandoverUrl({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'job-request-1',
      providerPhone: '+27820000000',
    })

    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/provider\/jobs\/job-request-1\/handover\?token=/)
    const token = decodeURIComponent(url!.split('token=')[1])
    expect(verifyProviderLeadAccessToken(token)).toMatchObject({
      status: 'active',
      payload: {
        leadId: 'lead-1',
        providerId: 'provider-1',
        jobRequestId: 'job-request-1',
        scopes: expect.arrayContaining(['view_job', 'confirm_arrival', 'contact_customer']),
      },
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

  it('rejects active tokens for inactive providers', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({
      provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27820000000', active: false, status: 'SUSPENDED' },
    }))

    await expect(resolveProviderLeadAccessToken(token)).resolves.toMatchObject({
      status: 'invalid',
      lead: null,
    })
  })

  it('withholds customer PII, full address, and attachments before unlock', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)
    const serialized = JSON.stringify(resolved)

    expect(resolved).toMatchObject({
      status: 'active',
      lead: {
        id: 'lead-1',
        unlock: null,
        jobRequest: {
          customer: null,
          address: { suburb: 'Sandton', city: 'Johannesburg' },
          attachments: [],
        },
      },
    })
    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(1)
    expect(mockDb.lead.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        jobRequest: {
          select: expect.not.objectContaining({
            customer: expect.anything(),
            attachments: expect.anything(),
          }),
        },
      }),
    }))
    expect(serialized).not.toContain('Nomsa Dlamini')
    expect(serialized).not.toContain('+27821234567')
    expect(serialized).not.toContain('12 Exact Street')
    expect(serialized).not.toContain('photo-private')
    expect(serialized).not.toContain('Gate code 1234')
  })

  it('invalidates an accepted-job token when the match is cancelled', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'job-request-1',
    })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({
      status: 'ACCEPTED',
      jobRequest: {
        id: 'job-request-1',
        category: 'Plumbing',
        title: 'Leaking pipe',
        description: 'Pipe leaking.',
        requestedWindowStart: null,
        requestedWindowEnd: null,
        requestedArrivalLatest: null,
        customerAcceptedAmount: null,
        address: { suburb: 'Sandton', city: 'Johannesburg' },
        match: { id: 'match-1', status: 'CANCELLED', createdAt: new Date(), customerContactedAt: null, plannedArrivalStart: null, plannedArrivalEnd: null, plannedArrivalNote: null, providerOnTheWayAt: null, providerArrivedAt: null, providerStartedAt: null, providerCompletedAt: null },
      },
    }))

    await expect(resolveProviderLeadAccessToken(token)).resolves.toMatchObject({
      status: 'invalid',
      lead: null,
    })
  })

  it('invalidates an accepted-job token when the job is reassigned (match cancelled and replaced)', async () => {
    // When a job is reassigned, the original match is cancelled.
    // The provider's accepted-job token must no longer grant access.
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'job-request-1',
    })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({
      status: 'ACCEPTED',
      jobRequest: {
        id: 'job-request-1',
        category: 'Plumbing',
        title: 'Leaking pipe',
        description: 'Pipe leaking.',
        requestedWindowStart: null,
        requestedWindowEnd: null,
        requestedArrivalLatest: null,
        customerAcceptedAmount: null,
        address: { suburb: 'Sandton', city: 'Johannesburg' },
        match: { id: 'match-1', status: 'CANCELLED', createdAt: new Date(), customerContactedAt: null, plannedArrivalStart: null, plannedArrivalEnd: null, plannedArrivalNote: null, providerOnTheWayAt: null, providerArrivedAt: null, providerStartedAt: null, providerCompletedAt: null },
      },
    }))

    await expect(resolveProviderLeadAccessToken(token)).resolves.toMatchObject({
      status: 'invalid',
      lead: null,
    })
  })

  it('loads sensitive lead fields only after unlock', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique
      .mockResolvedValueOnce(makeLead({
        unlock: { id: 'unlock-1', providerId: 'provider-1' },
      }))
      .mockResolvedValueOnce({
        jobRequest: {
          customer: { id: 'customer-1', name: 'Nomsa Dlamini', phone: '+27821234567' },
          address: {
            street: '12 Exact Street',
            addressLine1: 'Block B',
            addressLine2: null,
            complexName: 'Hidden Complex',
            unitNumber: 'Unit 7',
            suburb: 'Sandton',
            city: 'Johannesburg',
            province: 'Gauteng',
          },
          attachments: [{ id: 'photo-private', caption: 'Leak', label: 'before' }],
        },
      })

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(2)
    expect(resolved.lead?.jobRequest.customer).toMatchObject({
      name: 'Nomsa Dlamini',
      phone: '+27821234567',
    })
    expect(resolved.lead?.jobRequest.address).toMatchObject({
      street: '12 Exact Street',
      unitNumber: 'Unit 7',
    })
    expect(resolved.lead?.jobRequest.attachments).toEqual([
      { id: 'photo-private', caption: 'Leak', label: 'before' },
    ])
  })
})
