import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn(), findFirst: vi.fn() },
    leadUnlock: { findUnique: vi.fn() },
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
    provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27820000000', active: true, verified: true, status: 'ACTIVE' },
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
      address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: 'JHB North' },
      attachments: [
        {
          id: 'photo-preview-1',
          caption: 'Tap photo',
          label: 'customer_photo',
        },
      ],
      match: null,
    },
    ...overrides,
  }
}

describe('provider lead access tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockDb.lead.findFirst.mockReset()
    mockDb.lead.findFirst.mockResolvedValue(null)
    mockDb.leadUnlock.findUnique.mockReset()
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
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
        scopes: ['view_lead', 'accept_lead', 'decline_lead'],
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

  it('builds a scoped accepted-job handover URL from jobRequest + provider', async () => {
    const { getProviderSignedJobHandoverUrlForJobRequest, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    mockDb.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-2',
      providerId: 'provider-1',
      jobRequestId: 'job-request-2',
      provider: { phone: '+27820000000' },
      providerAcceptedAt: new Date('2026-05-21T08:00:00.000Z'),
      customerSelectedAt: new Date('2026-05-21T07:30:00.000Z'),
      sentAt: new Date('2026-05-21T07:00:00.000Z'),
    })

    const url = await getProviderSignedJobHandoverUrlForJobRequest({
      jobRequestId: 'job-request-2',
      providerId: 'provider-1',
    })

    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/provider\/jobs\/job-request-2\/handover\?token=/)
    const token = decodeURIComponent(url!.split('token=')[1])
    expect(verifyProviderLeadAccessToken(token)).toMatchObject({
      status: 'active',
      payload: {
        leadId: 'lead-2',
        providerId: 'provider-1',
        jobRequestId: 'job-request-2',
      },
    })
    expect(mockDb.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              'CUSTOMER_SELECTED',
              'PROVIDER_ACCEPTED',
              'CREDIT_REQUIRED',
              'CREDIT_APPLIED',
              'ACCEPTED',
              'ACCEPTED_LOCKED',
            ],
          },
        }),
      }),
    )
  })

  it('returns null for jobRequest/provider handover URLs when no eligible lead exists', async () => {
    const { getProviderSignedJobHandoverUrlForJobRequest } = await import('@/lib/provider-lead-access')
    mockDb.lead.findFirst.mockResolvedValueOnce(null)

    await expect(getProviderSignedJobHandoverUrlForJobRequest({
      jobRequestId: 'job-request-missing',
      providerId: 'provider-1',
    })).resolves.toBeNull()
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

  it('returns invalid instead of throwing when signing secrets are missing', async () => {
    delete process.env.PROVIDER_LEAD_ACCESS_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET

    const { verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const payload = Buffer.from(
      JSON.stringify({ v: 1, leadId: 'lead-1', providerId: 'provider-1', exp: Math.floor(Date.now() / 1000) + 600 }),
      'utf8',
    ).toString('base64url')
    const result = verifyProviderLeadAccessToken(`${payload}.fake-signature`)

    expect(result).toMatchObject({
      status: 'invalid',
      reason: 'SIGNING_SECRET_MISSING',
      payload: null,
    })
  })

  it('falls back to AUTH_SECRET when provider-specific signing secrets are absent', async () => {
    delete process.env.PROVIDER_LEAD_ACCESS_SECRET
    delete process.env.NEXTAUTH_SECRET
    process.env.AUTH_SECRET = 'test-auth-secret-fallback'

    const { createProviderLeadAccessToken, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(verifyProviderLeadAccessToken(token)).toMatchObject({
      status: 'active',
      payload: {
        leadId: 'lead-1',
        providerId: 'provider-1',
      },
    })
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
      reason: 'PROVIDER_NOT_ACTIVE',
    })
  })

  it('rejects active tokens for unverified providers under the Phase-1 unlock policy', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({
      provider: {
        id: 'provider-1',
        name: 'Sipho Pro',
        phone: '+27820000000',
        active: true,
        verified: false,
        status: 'ACTIVE',
      },
    }))

    await expect(resolveProviderLeadAccessToken(token)).resolves.toMatchObject({
      status: 'invalid',
      lead: null,
      reason: 'PROVIDER_NOT_APPROVED',
    })
  })

  it('withholds customer PII and full address before acceptance while allowing preview photos', async () => {
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
          address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng', region: 'JHB North' },
          attachments: [
            {
              id: 'photo-preview-1',
              caption: 'Tap photo',
              label: 'customer_photo',
            },
          ],
        },
      },
    })
    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(1)
    expect(mockDb.lead.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        jobRequest: {
          select: expect.objectContaining({
            attachments: expect.objectContaining({
              where: { safeForPreview: true },
            }),
          }),
        },
      }),
    }))
    expect(serialized).not.toContain('Nomsa Dlamini')
    expect(serialized).not.toContain('+27821234567')
    expect(serialized).not.toContain('12 Exact Street')
    expect(serialized).toContain('photo-preview-1')
    expect(serialized).not.toContain('Gate code 1234')
  })

  it('does not unlock customer details when the unlock belongs to a different provider', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({
      status: 'ACCEPTED',
      unlock: { id: 'unlock-1', providerId: 'provider-2' },
    }))

    const resolved = await resolveProviderLeadAccessToken(token)
    const serialized = JSON.stringify(resolved)

    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(1)
    expect(resolved.status).toBe('active')
    expect(resolved.lead?.jobRequest.customer).toBeNull()
    expect(serialized).not.toContain('+27821234567')
    expect(serialized).not.toContain('12 Exact Street')
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

  it('grants decline_lead scope on lead response tokens', async () => {
    const { createProviderLeadAccessToken, providerLeadTokenAllowsScope, verifyProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    const { payload } = verifyProviderLeadAccessToken(token)

    expect(providerLeadTokenAllowsScope(payload, 'decline_lead')).toBe(true)
  })

  it('denies decline_lead scope on accepted-job handover tokens', async () => {
    const { getProviderSignedJobHandoverUrl, verifyProviderLeadAccessToken, providerLeadTokenAllowsScope } = await import('@/lib/provider-lead-access')

    const url = await getProviderSignedJobHandoverUrl({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'job-request-1',
      providerPhone: '+27820000000',
    })
    const token = decodeURIComponent(url!.split('token=')[1])
    const { payload } = verifyProviderLeadAccessToken(token)

    expect(providerLeadTokenAllowsScope(payload, 'decline_lead')).toBe(false)
  })

  it('resolves a DECLINED lead so the caller can route to the already-closed idempotency path', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({ status: 'DECLINED' }))

    const resolved = await resolveProviderLeadAccessToken(token)

    // status stays 'active' — the caller inspects lead.status to determine the idempotency path.
    // declineLeadWithToken checks lead.status === 'DECLINED' and redirects to ?declined=already.
    expect(resolved.status).toBe('active')
    expect(resolved.lead?.status).toBe('DECLINED')
  })

  it('marks token invalid when the lead is not found in the database', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-missing', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(null)

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
  })

  it('loads customer PII and full address after acceptance; attachments come from first query', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique
      .mockResolvedValueOnce(makeLead({
        status: 'ACCEPTED',
      }))
      // Second query fetches only customer PII + full address — attachments are NOT re-fetched
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
        },
      })
    mockDb.leadUnlock.findUnique.mockResolvedValueOnce({
      id: 'unlock-1',
      providerId: 'provider-1',
      unlockedAt: new Date('2026-04-29T10:15:00.000Z'),
    })

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(mockDb.leadUnlock.findUnique).toHaveBeenCalledWith({
      where: { leadId: 'lead-1' },
      select: {
        id: true,
        providerId: true,
        unlockedAt: true,
      },
    })
    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(2)
    expect(resolved.lead?.unlock).toMatchObject({
      id: 'unlock-1',
      providerId: 'provider-1',
      creditsCharged: 1,
    })
    expect(resolved.lead?.jobRequest.customer).toMatchObject({
      name: 'Nomsa Dlamini',
      phone: '+27821234567',
    })
    expect(resolved.lead?.jobRequest.address).toMatchObject({
      street: '12 Exact Street',
      unitNumber: 'Unit 7',
    })
    // Attachments come from the first query (preview photos always available)
    expect(resolved.lead?.jobRequest.attachments).toEqual([
      { id: 'photo-preview-1', caption: 'Tap photo', label: 'customer_photo' },
    ])
  })
})

// ─── Security: phone hash binding and cross-provider access prevention ─────────

describe('provider lead access — phone hash and sender verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-provider-lead-secret'
    process.env.PROVIDER_LEAD_APP_URL = 'https://app.plugapro.co.za'
  })

  it('rejects a token whose providerPhoneHash does not match the stored provider phone', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken, hashProviderPhone } = await import('@/lib/provider-lead-access')
    // Token is created for a provider whose phone is +27820000000
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      providerPhone: '+27820000000',
    })
    // But the DB record has a different phone — indicates token was replayed
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead({
      provider: { id: 'provider-1', name: 'Sipho Pro', phone: '+27829999999', active: true, status: 'ACTIVE' },
    }))

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
    expect(resolved.traceId).toBeTruthy()
  })

  it('accepts a token when providerPhoneHash matches the stored provider phone', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      providerPhone: '+27820000000',
    })
    // DB record has the matching phone
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('active')
    expect(resolved.lead).not.toBeNull()
  })

  it('accepts a token with no providerPhoneHash without phone validation', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // No phone provided → no hash in token
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('active')
    expect(resolved.lead).not.toBeNull()
  })

  it('rejects when assertSenderPhone does not match the stored provider phone', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    // Wrong number is sending the command — different WhatsApp user
    const resolved = await resolveProviderLeadAccessToken(token, { assertSenderPhone: '+27821111111' })

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
    expect(resolved.traceId).toBeTruthy()
  })

  it('accepts when assertSenderPhone matches the stored provider phone', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token, { assertSenderPhone: '+27820000000' })

    expect(resolved.status).toBe('active')
    expect(resolved.lead).not.toBeNull()
  })

  it('returns a traceId on successful resolution', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    const token = createProviderLeadAccessToken({ leadId: 'lead-1', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(makeLead())

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('active')
    expect(resolved.traceId).toMatch(/^[0-9a-f-]{8}/)
  })

  it('cannot use provider-1 token to access provider-2 lead', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // Token claims provider-1 but DB lead belongs to provider-2
    const token = createProviderLeadAccessToken({ leadId: 'lead-2', providerId: 'provider-1' })
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLead({ id: 'lead-2', providerId: 'provider-2' }),
    )

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
    expect(resolved.traceId).toBeTruthy()
  })

  it('cannot use provider-1 token to access a different job request than embedded', async () => {
    const { createProviderLeadAccessToken, resolveProviderLeadAccessToken } = await import('@/lib/provider-lead-access')
    // Token has jobRequestId embedded
    const token = createProviderLeadAccessToken({
      leadId: 'lead-1',
      providerId: 'provider-1',
      jobRequestId: 'jr-original',
    })
    // DB returns a lead linked to a different job request
    mockDb.lead.findUnique.mockResolvedValueOnce(
      makeLead({ jobRequestId: 'jr-different' }),
    )

    const resolved = await resolveProviderLeadAccessToken(token)

    expect(resolved.status).toBe('invalid')
    expect(resolved.lead).toBeNull()
  })
})
