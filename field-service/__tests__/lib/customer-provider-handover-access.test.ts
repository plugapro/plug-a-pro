import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

function acceptedLead(overrides: Record<string, unknown> = {}) {
  const { jobRequest: jobRequestOverrides, ...leadOverrides } = overrides
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    jobRequestId: 'job-request-1',
    status: 'ACCEPTED',
    jobRequest: {
      id: 'job-request-1',
      status: 'MATCHED',
      category: 'Plumbing',
      title: 'Leaking pipe',
      description: 'Pipe leaking under the sink.',
      customerAccessToken: 'ticket-token',
      customerAccessTokenExpiresAt: new Date('2026-05-29T10:00:00.000Z'),
      customerAccessTokenRevokedAt: null,
      customer: { id: 'customer-1', name: 'Nomsa Dlamini' },
      address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng' },
      attachments: [{ id: 'photo-1', caption: 'Leak', label: null }],
      match: {
        id: 'match-1',
        providerId: 'provider-1',
        status: 'MATCHED',
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        provider: {
          id: 'provider-1',
          name: 'Sipho Pro',
          phone: '+27820000000',
          bio: 'Plumbing specialist',
          experience: '8 years',
          skills: ['plumbing'],
          serviceAreas: ['Sandton'],
          evidenceNote: 'Verified marketplace documents',
          avatarUrl: null,
          verified: true,
        },
      },
      ...(jobRequestOverrides as Record<string, unknown> | undefined),
    },
    ...leadOverrides,
  }
}

describe('customer provider handover access tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CUSTOMER_HANDOVER_ACCESS_SECRET = 'test-customer-handover-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.plugapro.co.za'
  })

  it('builds a signed customer handover URL and resolves the accepted provider', async () => {
    const {
      getCustomerProviderHandoverUrl,
      resolveCustomerProviderHandoverToken,
      verifyCustomerProviderHandoverToken,
    } = await import('@/lib/customer-provider-handover-access')
    mockDb.lead.findUnique.mockResolvedValue(acceptedLead())

    const url = await getCustomerProviderHandoverUrl({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'job-request-1',
    })
    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/requests\/handover\//)
    const token = decodeURIComponent(url!.split('/requests/handover/')[1])

    expect(verifyCustomerProviderHandoverToken(token)).toMatchObject({
      status: 'active',
      payload: {
        leadId: 'lead-1',
        providerId: 'provider-1',
        jobRequestId: 'job-request-1',
      },
    })
    await expect(resolveCustomerProviderHandoverToken(token)).resolves.toMatchObject({
      status: 'active',
      handover: {
        leadId: 'lead-1',
        match: {
          provider: {
            phone: '+27820000000',
          },
        },
      },
    })
  })

  it('rejects a handover token after reassignment or cancellation', async () => {
    const { createCustomerProviderHandoverToken, resolveCustomerProviderHandoverToken } = await import('@/lib/customer-provider-handover-access')
    const token = createCustomerProviderHandoverToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'job-request-1',
    })
    mockDb.lead.findUnique.mockResolvedValue(acceptedLead({
      jobRequest: {
        match: {
          id: 'match-1',
          providerId: 'provider-2',
          status: 'MATCHED',
          createdAt: new Date('2026-04-29T10:00:00.000Z'),
          provider: {
            id: 'provider-2',
            name: 'Other Provider',
            phone: '+27829999999',
            bio: null,
            experience: null,
            skills: [],
            serviceAreas: [],
            evidenceNote: null,
            avatarUrl: null,
            verified: true,
          },
        },
      },
    }))

    await expect(resolveCustomerProviderHandoverToken(token)).resolves.toMatchObject({
      status: 'invalid',
      handover: null,
    })

    mockDb.lead.findUnique.mockResolvedValue(acceptedLead({
      jobRequest: {
        status: 'CANCELLED',
      },
    }))

    await expect(resolveCustomerProviderHandoverToken(token)).resolves.toMatchObject({
      status: 'invalid',
      handover: null,
    })
  })
})
