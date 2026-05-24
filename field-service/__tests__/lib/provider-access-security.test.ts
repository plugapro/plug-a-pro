// ─── Provider access security — unauthorized access prevention ────────────────
// Focused regression suite for CODEX-15 security requirements:
//  1. WhatsApp sender number must map to the correct provider (done via whatsapp-identity)
//  2. Secure tokens scoped to provider/lead/job cannot be replayed by wrong party
//  3. Provider can view only own opportunities and jobs
//  4. Safe preview excludes protected customer fields
//  5. Full details only after accepted-provider unlock
//  6. Non-selected providers cannot access accepted-job details
//  7. Expired/superseded invites revoke full-detail access
//  8. Attachment access requires authorization (see attachments-authz.test.ts)
//  9. Admin-only data must not appear in provider token resolution
// 10. resolveProviderLeadAttachmentScope returns isAccepted to enforce safeForPreview

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn() },
    leadUnlock: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    jobRequestId: 'jr-1',
    status: 'SENT',
    sentAt: new Date('2026-05-01T10:00:00.000Z'),
    expiresAt: new Date('2026-05-04T10:00:00.000Z'),
    provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27820000000', active: true, verified: true, status: 'ACTIVE' },
    unlock: null,
    jobRequest: {
      id: 'jr-1',
      category: 'Plumbing',
      title: 'Leaking pipe',
      // 14× repetition = 280 chars; previewNotes truncates at 180 — private text after that is hidden
      description: `${'Preview notes visible. '.repeat(14)}Gate code 9999 and private unit after unlock.`,
      requestedWindowStart: null,
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
      customerAcceptedAmount: null,
      address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: 'JHB North' },
      attachments: [{ id: 'att-preview-1', caption: 'Tap photo', label: 'customer_photo' }],
      match: null,
    },
    ...overrides,
  }
}

describe('secure token scope — cross-provider access prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockDb.leadUnlock.findUnique.mockReset()
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-pla-secret-step14'
    process.env.PROVIDER_LEAD_APP_URL = 'https://app.plugapro.co.za'
  })

  it('rejects a token whose providerId does not match the lead owner', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // Token is for provider-99, but lead belongs to provider-1
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-99' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
  })

  it('rejects a token when the phone hash in the payload does not match the provider record', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // Token issued with a different phone
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      providerPhone: '+27821111111',
    })
    // DB provider has a different phone
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLead({ provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27820000000', active: true, verified: true, status: 'ACTIVE' } }),
    )

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
  })

  it('rejects a token when assertSenderPhone is a different WhatsApp number', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    // The inbound message is from a different phone
    const resolved = await resolveProviderLeadAccessToken(token, { assertSenderPhone: '+27829000000' })

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
  })

  it('cannot upgrade lead-response scoped token to accepted-job scope', async () => {
    const { createProviderLeadAccessToken, providerLeadTokenAllowsScope, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // Lead-response tokens carry view_lead, accept_lead, decline_lead only
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      scopes: ['view_lead', 'accept_lead', 'decline_lead'],
    })
    const { payload } = verifyProviderLeadAccessToken(token)

    // Should not grant job-execution scopes
    expect(providerLeadTokenAllowsScope(payload, 'confirm_arrival')).toBe(false)
    expect(providerLeadTokenAllowsScope(payload, 'start_job')).toBe(false)
    expect(providerLeadTokenAllowsScope(payload, 'complete_job')).toBe(false)
    expect(providerLeadTokenAllowsScope(payload, 'contact_customer')).toBe(false)
  })

  it('cannot use accepted-job token to decline the lead', async () => {
    const { createProviderLeadAccessToken, providerLeadTokenAllowsScope, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      scopes: ['view_job', 'confirm_arrival', 'mark_on_the_way', 'mark_arrived', 'start_job', 'complete_job', 'contact_customer'],
    })
    const { payload } = verifyProviderLeadAccessToken(token)

    expect(providerLeadTokenAllowsScope(payload, 'decline_lead')).toBe(false)
    expect(providerLeadTokenAllowsScope(payload, 'accept_lead')).toBe(false)
  })
})

describe('customer PII gating — pre/post acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockDb.leadUnlock.findUnique.mockReset()
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-pla-secret-step14'
  })

  it('safe preview must not include street, unit, complex, GPS, or customer phone', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)
    expect(resolved.status).toBe('active')

    const serialized = JSON.stringify(resolved.lead)
    // Protected fields must not appear before acceptance
    expect(serialized).not.toContain('+27821234567') // customer phone
    expect(serialized).not.toContain('Gate code 9999') // private notes
    expect(resolved.lead?.jobRequest.customer).toBeNull()
    // Public suburb/city preview is allowed
    expect(resolved.lead?.jobRequest.address).toMatchObject({ suburb: 'Sandton', city: 'Johannesburg' })
  })

  it('accepted provider receives customer phone and street address', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique
      .mockResolvedValueOnce(
        makeLead({ status: 'ACCEPTED' }),
      )
      .mockResolvedValueOnce({
        jobRequest: {
          customer: { id: 'c-1', name: 'Nomsa Dlamini', phone: '+27821234567' },
          address: {
            street: '14 Exact Street',
            addressLine1: null,
            addressLine2: null,
            complexName: null,
            unitNumber: 'Unit 3',
            suburb: 'Sandton',
            city: 'Johannesburg',
            province: 'Gauteng',
            region: null,
          },
        },
      })
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      providerId: 'provider-1',
      unlockedAt: new Date('2026-05-01T10:15:00.000Z'),
    })

    const resolved = await resolveProviderLeadAccessToken(token)
    expect(resolved.status).toBe('active')
    expect(resolved.lead?.jobRequest.customer).toMatchObject({ phone: '+27821234567', name: 'Nomsa Dlamini' })
    expect(resolved.lead?.jobRequest.address).toMatchObject({ street: '14 Exact Street', unitNumber: 'Unit 3' })
  })

  it('non-selected provider cannot access full customer details even if lead is ACCEPTED by another', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // provider-2 has their own lead (SENT) but tries to use a token
    const token = createProviderLeadAccessToken({ leadId: 'lead-2', providerId: 'provider-2' })
    // DB: lead-2 belongs to provider-2 but the unlock was done by provider-1
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLead({
        id: 'lead-2',
        providerId: 'provider-2',
        status: 'ACCEPTED',
        provider: { id: 'provider-2', name: 'Other Pro', phone: '+27829000000', active: true, verified: true, status: 'ACTIVE' },
      }),
    )
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      providerId: 'provider-1',
      unlockedAt: new Date('2026-05-01T10:15:00.000Z'),
    })

    const resolved = await resolveProviderLeadAccessToken(token)

    // Access is active but customer details are withheld (unlock doesn't match)
    expect(resolved.status).toBe('active')
    expect(resolved.lead?.jobRequest.customer).toBeNull()
    // Only one DB call (no second query for PII)
    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(1)
  })

  it('admin-only fields (strikes, kycStatus, payoutVerifiedAt) are absent from token resolution', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)
    const serialized = JSON.stringify(resolved)

    expect(serialized).not.toContain('strikes')
    expect(serialized).not.toContain('kycStatus')
    expect(serialized).not.toContain('payoutVerifiedAt')
    expect(serialized).not.toContain('suspendedReason')
    expect(serialized).not.toContain('archiveReason')
    expect(serialized).not.toContain('internalFlags')
  })
})

describe('expired and superseded token revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockDb.leadUnlock.findUnique.mockReset()
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-pla-secret-step14'
  })

  it('expired token cannot be used to access full details after expiry', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const pastExpiry = new Date(Date.now() - 1000)
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1', expiresAt: pastExpiry })

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('expired')
    expect(resolved.lead).toBeNull()
  })

  it('superseded token (match cancelled after acceptance) cannot unlock customer details', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLead({
        status: 'ACCEPTED',
        jobRequest: {
          id: 'jr-1',
          category: 'Plumbing',
          title: 'Leaking pipe',
          description: 'Description',
          requestedWindowStart: null,
          requestedWindowEnd: null,
          requestedArrivalLatest: null,
          customerAcceptedAmount: null,
          address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: null },
          attachments: [],
          match: { id: 'm-1', status: 'CANCELLED', createdAt: new Date(), customerContactedAt: null, plannedArrivalStart: null, plannedArrivalEnd: null, plannedArrivalNote: null, providerOnTheWayAt: null, providerArrivedAt: null, providerStartedAt: null, providerCompletedAt: null },
        },
      }),
    )
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      providerId: 'provider-1',
      unlockedAt: new Date('2026-05-01T10:15:00.000Z'),
    })

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
    // Confirm traceId is present for audit
    expect(resolved.traceId).toBeTruthy()
  })
})

describe('resolveProviderLeadAttachmentScope — isAccepted flag for safeForPreview enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockDb.leadUnlock.findUnique.mockReset()
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-pla-secret-step15'
  })

  it('returns isAccepted=false for a SENT lead (preview context)', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({ status: 'SENT' }))

    const scope = await resolveProviderLeadAttachmentScope(token)

    expect(scope.status).toBe('active')
    expect(scope.jobRequestId).toBe('jr-1')
    expect((scope as { isAccepted?: boolean }).isAccepted).toBe(false)
  })

  it('returns isAccepted=true for an ACCEPTED lead with matching unlock', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique
      .mockResolvedValueOnce(
        makeLead({ status: 'ACCEPTED' }),
      )
      // Second call for the sensitive data fetch — return minimal shape
      .mockResolvedValueOnce({
        jobRequest: {
          customer: { id: 'c-1', name: 'Test', phone: '+27820000001' },
          address: {
            street: '1 Street',
            addressLine1: null,
            addressLine2: null,
            complexName: null,
            unitNumber: null,
            suburb: 'Sandton',
            city: 'Johannesburg',
            province: 'Gauteng',
            region: null,
          },
        },
      })
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      providerId: 'provider-1',
      unlockedAt: new Date('2026-05-01T10:15:00.000Z'),
    })

    const scope = await resolveProviderLeadAttachmentScope(token)

    expect(scope.status).toBe('active')
    expect((scope as { isAccepted?: boolean }).isAccepted).toBe(true)
  })

  it('returns isAccepted=false when the unlock belongs to a different provider', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({ status: 'ACCEPTED' }))
    // Unlock is by provider-99, not provider-1
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-x',
      providerId: 'provider-99',
      unlockedAt: new Date('2026-05-01T10:15:00.000Z'),
    })

    const scope = await resolveProviderLeadAttachmentScope(token)

    expect(scope.status).toBe('active')
    expect((scope as { isAccepted?: boolean }).isAccepted).toBe(false)
  })

  it('returns invalid status for an expired token', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAttachmentScope } = await import('@/lib/provider-lead-access')
    const pastExpiry = new Date(Date.now() - 1000)
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1', expiresAt: pastExpiry })

    const scope = await resolveProviderLeadAttachmentScope(token)

    expect(scope.status).toBe('expired')
    expect(scope.jobRequestId).toBeNull()
  })
})
