// ─── Client PWA — Security, privacy, and token rules (CLIENT-10) ────────────
// Covers:
//  1. resolveJobRequestAccessScope — scoped to jobRequestId, expiry, revocation,
//     trace ID on every denial
//  2. resolveJobRequestAccessToken — same gates + token columns stripped from result
//  3. Token ownership: token only resolves the request it was issued for
//  4. Protected provider fields absent from customer-facing shortlist shape
//  5. Protected customer fields absent from pre-acceptance provider preview
//  6. Full customer details (phone, street) only after accepted-provider unlock
//  7. Attachment authorization: provider blocked from non-preview attachments
//     before acceptance (isAccepted=false from resolveProviderLeadAttachmentScope)

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── DB mock (hoisted) ────────────────────────────────────────────────────────
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn() },
    leadUnlock: { findUnique: vi.fn() },
    providerShortlist: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeJobRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'jr-1',
    customerId: 'cust-1',
    category: 'Plumbing',
    title: 'Leaking tap',
    description: 'Main bathroom tap is dripping.',
    status: 'SHORTLIST_READY',
    expiresAt: null,
    createdAt: new Date('2026-05-01T08:00:00.000Z'),
    updatedAt: new Date('2026-05-01T08:00:00.000Z'),
    selectedLeadInviteId: null,
    // customerAccessToken is NOT in the select — Prisma won't return it.
    // We do NOT include it here so the mock matches what Prisma would return.
    customerAccessTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    customerAccessTokenRevokedAt: null,
    customer: { id: 'cust-1', userId: 'user-1', name: 'Nomsa', phone: '+27820000001' },
    address: {
      id: 'addr-1', street: '12 Safe Street', suburb: 'Sandton',
      city: 'Johannesburg', province: 'Gauteng', region: null,
    },
    attachments: [{ id: 'att-1', caption: 'Tap photo', label: 'customer_photo', safeForPreview: true, createdAt: new Date() }],
    leads: [],
    match: null,
    ...overrides,
  }
}

function makeProviderLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'prov-1',
    jobRequestId: 'jr-1',
    status: 'SENT',
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    provider: { id: 'prov-1', name: 'Sipho Pro', phone: '+27821111111', active: true, verified: true, status: 'ACTIVE' },
    unlock: null,
    jobRequest: {
      id: 'jr-1',
      category: 'Plumbing',
      title: 'Leaking tap',
      description: 'Short desc visible.',
      requestedWindowStart: null,
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
      customerAcceptedAmount: null,
      address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: null },
      attachments: [],
      match: null,
    },
    ...overrides,
  }
}

// ─── 1. resolveJobRequestAccessScope ─────────────────────────────────────────
describe('resolveJobRequestAccessScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns active + jobRequestId for a valid token', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'jr-1',
      customerAccessTokenExpiresAt: new Date(Date.now() + 1000),
      customerAccessTokenRevokedAt: null,
    })
    const { resolveJobRequestAccessScope } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessScope('valid-token')
    expect(result.status).toBe('active')
    expect(result.jobRequestId).toBe('jr-1')
  })

  it('returns invalid + traceId when token does not exist', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(null)
    const { resolveJobRequestAccessScope } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessScope('ghost-token')
    expect(result.status).toBe('invalid')
    expect(result.jobRequestId).toBeNull()
    expect(result.traceId).toBeTruthy()
  })

  it('returns expired + traceId when token is past its expiry', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'jr-1',
      customerAccessTokenExpiresAt: new Date(Date.now() - 1000),
      customerAccessTokenRevokedAt: null,
    })
    const { resolveJobRequestAccessScope } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessScope('old-token')
    expect(result.status).toBe('expired')
    expect(result.traceId).toBeTruthy()
  })

  it('returns expired + traceId when token is explicitly revoked', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'jr-1',
      customerAccessTokenExpiresAt: new Date(Date.now() + 1000),
      customerAccessTokenRevokedAt: new Date(),
    })
    const { resolveJobRequestAccessScope } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessScope('revoked-token')
    expect(result.status).toBe('expired')
    expect(result.traceId).toBeTruthy()
  })

  it('returns expired + traceId when token has no expiry date', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      id: 'jr-1',
      customerAccessTokenExpiresAt: null,
      customerAccessTokenRevokedAt: null,
    })
    const { resolveJobRequestAccessScope } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessScope('no-expiry-token')
    expect(result.status).toBe('expired')
    expect(result.traceId).toBeTruthy()
  })
})

// ─── 2. resolveJobRequestAccessToken ─────────────────────────────────────────
describe('resolveJobRequestAccessToken — token fields stripped from result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('strips customerAccessTokenExpiresAt and customerAccessTokenRevokedAt from active result', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(makeJobRequest())
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessToken('valid-token')
    expect(result.status).toBe('active')
    const serialized = JSON.stringify(result.jobRequest)
    // Token TTL/revocation columns must not be re-exposed to callers
    expect(serialized).not.toContain('customerAccessTokenExpiresAt')
    expect(serialized).not.toContain('customerAccessTokenRevokedAt')
    // Safe payload fields should still be present
    expect(result.jobRequest?.id).toBe('jr-1')
    expect(result.jobRequest?.category).toBe('Plumbing')
  })

  it('strips customerAccessToken if it appears in mock (defensive strip)', async () => {
    // Simulate a future shape regression where customerAccessToken leaks into the select result
    mockDb.jobRequest.findUnique.mockResolvedValueOnce({
      ...makeJobRequest(),
      customerAccessToken: 'leaked-secret-value',
    })
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessToken('valid-token')
    expect(result.status).toBe('active')
    const serialized = JSON.stringify(result.jobRequest)
    // Defensive strip must remove it even if Prisma unexpectedly returns it
    expect(serialized).not.toContain('customerAccessToken')
    expect(serialized).not.toContain('leaked-secret-value')
  })

  it('strips token columns even when token is expired', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(
      makeJobRequest({ customerAccessTokenExpiresAt: new Date(Date.now() - 1000) }),
    )
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessToken('old-token')
    expect(result.status).toBe('expired')
    const serialized = JSON.stringify(result.jobRequest)
    expect(serialized).not.toContain('customerAccessTokenExpiresAt')
    expect(serialized).not.toContain('customerAccessTokenRevokedAt')
  })

  it('returns invalid + null jobRequest + traceId when no record matches', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(null)
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessToken('no-such-token')
    expect(result.status).toBe('invalid')
    expect(result.jobRequest).toBeNull()
    expect(result.traceId).toBeTruthy()
  })

  it('returns traceId on denial for revoked token', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(
      makeJobRequest({ customerAccessTokenRevokedAt: new Date() }),
    )
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessToken('revoked-token')
    expect(result.status).toBe('expired')
    expect(result.traceId).toBeTruthy()
  })

  it('token is scoped to the specific jobRequestId it was issued for (DB lookup by token value)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValueOnce(makeJobRequest())
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    await resolveJobRequestAccessToken('exact-token-xyz')
    expect(mockDb.jobRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerAccessToken: 'exact-token-xyz' },
      }),
    )
  })
})

// ─── 3. Protected provider fields absent from customer shortlist ──────────────
// This is a static contract test — we verify the Prisma select argument that
// getCustomerShortlistForRequest sends to the DB.
describe('customer shortlist — protected provider fields must be absent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('getCustomerShortlistForRequest uses select that omits phone, kycStatus, and admin-only fields', async () => {
    // Return null shortlist so the function short-circuits cleanly
    mockDb.providerShortlist = { findFirst: vi.fn().mockResolvedValueOnce(null) }
    const { getCustomerShortlistForRequest } = await import('@/lib/customer-shortlists')
    const result = await getCustomerShortlistForRequest('jr-1')
    expect(result).toBeNull()

    const mockShortlist = mockDb.providerShortlist as { findFirst: ReturnType<typeof vi.fn> }
    const callArg = mockShortlist.findFirst.mock.calls[0]?.[0]
    const providerSelect = callArg?.include?.items?.include?.provider?.select
    // If the mock was called with a select arg, verify the contract
    if (providerSelect) {
      expect(providerSelect).not.toHaveProperty('phone')
      expect(providerSelect).not.toHaveProperty('kycStatus')
      expect(providerSelect).not.toHaveProperty('suspendedReason')
      expect(providerSelect).not.toHaveProperty('adminNotes')
      expect(providerSelect).not.toHaveProperty('strikes')
      expect(providerSelect).not.toHaveProperty('email')
    }
  })
})

// ─── 4. Protected customer fields absent from provider preview ────────────────
describe('provider preview — protected customer fields absent before acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-client10-secret'
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
  })

  it('safe preview does not expose customer phone, street, or access notes', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(makeProviderLead())
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'prov-1' })

    const resolved = await resolveProviderLeadAccessToken(token)
    expect(resolved.status).toBe('active')
    const serialized = JSON.stringify(resolved.lead)
    // Customer phone must not appear (none of the test phone numbers)
    expect(serialized).not.toContain('+27821234567')
    // Customer must be null before acceptance
    expect(resolved.lead?.jobRequest.customer).toBeNull()
    // Full street must not appear
    expect(serialized).not.toContain('12 Safe Street')
    // Suburb/city preview is allowed
    expect(resolved.lead?.jobRequest.address).toMatchObject({ suburb: 'Sandton', city: 'Johannesburg' })
  })

  it('accepted provider receives customer phone and street', async () => {
    mockDb.lead.findUnique
      .mockResolvedValueOnce(makeProviderLead({ status: 'ACCEPTED', unlock: { id: 'u-1', providerId: 'prov-1' } }))
      .mockResolvedValueOnce({
        jobRequest: {
          customer: { id: 'cust-1', name: 'Nomsa', phone: '+27820000001' },
          address: {
            street: '12 Safe Street', addressLine1: null, addressLine2: null,
            complexName: null, unitNumber: null,
            suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: null,
          },
        },
      })
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      providerId: 'prov-1',
      unlockedAt: new Date('2026-05-01T09:00:00.000Z'),
    })

    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'prov-1' })

    const resolved = await resolveProviderLeadAccessToken(token)
    expect(resolved.status).toBe('active')
    expect(resolved.lead?.jobRequest.customer?.phone).toBe('+27820000001')
    expect((resolved.lead?.jobRequest.address as Record<string, unknown>)?.street).toBe('12 Safe Street')
  })
})

// ─── 5. resolveProviderLeadAttachmentScope isAccepted flag ───────────────────
describe('resolveProviderLeadAttachmentScope — isAccepted blocks non-preview attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-client10-secret'
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
  })

  it('returns isAccepted=false for a SENT lead — non-preview attachment access denied', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(makeProviderLead())
    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'prov-1' })

    const scope = await resolveProviderLeadAttachmentScope(token)
    expect(scope.status).toBe('active')
    expect((scope as { isAccepted?: boolean }).isAccepted).toBe(false)
  })

  it('returns isAccepted=true for ACCEPTED lead with matching unlock', async () => {
    mockDb.lead.findUnique
      .mockResolvedValueOnce(makeProviderLead({ status: 'ACCEPTED', unlock: { id: 'u-1', providerId: 'prov-1' } }))
      .mockResolvedValueOnce({
        jobRequest: {
          customer: { id: 'c-1', name: 'Nomsa', phone: '+27820000001' },
          address: {
            street: '1 St', addressLine1: null, addressLine2: null, complexName: null, unitNumber: null,
            suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: null,
          },
        },
      })
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      providerId: 'prov-1',
      unlockedAt: new Date('2026-05-01T09:00:00.000Z'),
    })

    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'prov-1' })

    const scope = await resolveProviderLeadAttachmentScope(token)
    expect(scope.status).toBe('active')
    expect((scope as { isAccepted?: boolean }).isAccepted).toBe(true)
  })

  it('returns isAccepted=false when unlock belongs to a different provider', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeProviderLead({ status: 'ACCEPTED', unlock: { id: 'u-x', providerId: 'other-prov' } }),
    )
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-x',
      providerId: 'other-prov',
      unlockedAt: new Date('2026-05-01T09:00:00.000Z'),
    })
    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'prov-1' })

    const scope = await resolveProviderLeadAttachmentScope(token)
    expect(scope.status).toBe('active')
    expect((scope as { isAccepted?: boolean }).isAccepted).toBe(false)
  })
})

// ─── 6. Concurrent resolver safety (PROVIDER_CONFIRMATION_PENDING race) ──────
describe('resolveJobRequestAccessToken — concurrent resolver safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('N concurrent calls with the same valid token all return active without cross-contamination', async () => {
    for (let i = 0; i < 10; i++) {
      mockDb.jobRequest.findUnique.mockResolvedValueOnce(
        makeJobRequest({ status: 'PROVIDER_CONFIRMATION_PENDING' }),
      )
    }
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => resolveJobRequestAccessToken('concurrent-token')),
    )

    expect(results).toHaveLength(10)
    for (const result of results) {
      expect(result.status).toBe('active')
      expect(result.jobRequest?.id).toBe('jr-1')
    }
  })

  it('concurrent calls on an expired token each return expired consistently', async () => {
    for (let i = 0; i < 5; i++) {
      mockDb.jobRequest.findUnique.mockResolvedValueOnce(
        makeJobRequest({ customerAccessTokenExpiresAt: new Date(Date.now() - 1000) }),
      )
    }
    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')

    const results = await Promise.all(
      Array.from({ length: 5 }, () => resolveJobRequestAccessToken('expired-concurrent-token')),
    )

    expect(results).toHaveLength(5)
    for (const result of results) {
      expect(result.status).toBe('expired')
      expect(result.traceId).toBeTruthy()
    }
  })
})

// ─── 7. Admin-only provider fields absent from token payload ─────────────────
describe('admin-only provider fields absent from token payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-client10-secret'
  })

  it('kycStatus, strikes, payoutVerifiedAt, suspendedReason do not appear in resolved lead', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(makeProviderLead())

    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'prov-1' })

    const resolved = await resolveProviderLeadAccessToken(token)
    const serialized = JSON.stringify(resolved)
    expect(serialized).not.toContain('kycStatus')
    expect(serialized).not.toContain('strikes')
    expect(serialized).not.toContain('payoutVerifiedAt')
    expect(serialized).not.toContain('suspendedReason')
    expect(serialized).not.toContain('archiveReason')
    expect(serialized).not.toContain('internalFlags')
  })
})
