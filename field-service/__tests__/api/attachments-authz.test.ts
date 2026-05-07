// ─── Regression: attachment authorization ─────────────────────────────────────
// Verifies that providers can only access attachments for jobs they own (WS-D).
// The bug was: check used uploadedBy === session.id (uploader) instead of
// job.providerId === provider.id (job ownership).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockDb,
  mockFetch,
  mockHead,
  mockResolveJobRequestAccessScope,
  mockResolveProviderLeadAttachmentScope,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    attachment: { findUnique: vi.fn() },
    provider: { findUnique: vi.fn() },
    customer: { findUnique: vi.fn(), update: vi.fn() },
    lead: { findUnique: vi.fn() },
  },
  mockFetch: vi.fn(),
  mockHead: vi.fn(),
  mockResolveJobRequestAccessScope: vi.fn(),
  mockResolveProviderLeadAttachmentScope: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@vercel/blob', () => ({ head: mockHead }))
vi.mock('@/lib/job-request-access', () => ({
  resolveJobRequestAccessScope: mockResolveJobRequestAccessScope,
}))
vi.mock('@/lib/provider-lead-access', () => ({
  resolveProviderLeadAttachmentScope: mockResolveProviderLeadAttachmentScope,
}))
vi.stubGlobal('fetch', mockFetch)

// Dynamic import so mocks are set up before module loads
async function getHandler() {
  const mod = await import('../../app/api/attachments/[id]/route')
  return mod.GET
}

const makeRequest = () =>
  new NextRequest('http://localhost/api/attachments/att-1')

const makeTokenRequest = (token: string) =>
  new NextRequest(`http://localhost/api/attachments/att-1?token=${token}`)

const makeLeadTokenRequest = (token: string) =>
  new NextRequest(`http://localhost/api/attachments/att-1?leadToken=${token}`)

const makeParams = () =>
  Promise.resolve({ id: 'att-1' }) as Promise<{ id: string }>

const ATTACHMENT_JOB_PROVIDER = {
  id: 'att-1',
  url: 'https://blob.example.com/att-1',
  mimeType: 'image/jpeg',
  blobKey: 'jobs/att-1.jpg',
  uploadedBy: 'some-other-user-id', // Uploaded by someone else
  job: {
    providerId: 'provider-db-id', // The correct owner
    booking: null,
  },
  jobRequest: null,
}

describe('GET /api/attachments/[id] — provider job ownership check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHead.mockResolvedValue({
      downloadUrl: 'https://blob.example.com/download/att-1',
    })
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
      status: 200,
    })
    mockResolveJobRequestAccessScope.mockResolvedValue({
      status: 'invalid',
      jobRequestId: null,
    })
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'invalid',
      jobRequestId: null,
    })
    mockDb.lead.findUnique.mockResolvedValue(null)
  })

  it('allows a provider whose Provider.id matches job.providerId', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(200)
    expect(mockHead).toHaveBeenCalledWith('https://blob.example.com/att-1')
    // Must look up provider record by userId, not trust session.id directly
    expect(mockDb.provider.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'supabase-uid' } }),
    )
  })

  it('denies a provider whose Provider.id does NOT match job.providerId', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    // Provider record has a different DB id than the job owner
    mockDb.provider.findUnique.mockResolvedValue({ id: 'different-provider-id' })
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(403)
  })

  it('allows an authenticated invited provider to preview customer photos before acceptance', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: 'VIEWED',
      expiresAt: new Date(Date.now() + 60_000),
      jobRequest: { match: { status: 'OFFERED' } },
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      jobRequest: {
        id: 'jr-1',
        customer: { id: 'cust-db-id' },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(200)
    expect(mockDb.lead.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jobRequestId_providerId: {
            jobRequestId: 'jr-1',
            providerId: 'provider-db-id',
          },
        },
      }),
    )
  })

  it('denies an invited provider whose underlying match was cancelled', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: 'VIEWED',
      expiresAt: new Date(Date.now() + 60_000),
      jobRequest: { match: { status: 'CANCELLED' } },
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      jobRequest: {
        id: 'jr-1',
        customer: { id: 'cust-db-id' },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(403)
  })

  it('denies a provider with no Provider record (unlinked user)', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue(null)
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(403)
  })

  it('allows a customer whose userId matches via the job booking chain', async () => {
    mockGetSession.mockResolvedValue({ id: 'customer-uid', role: 'customer', phone: '+27821234567' })
    mockDb.customer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'cust-db-id',
        userId: null,
        phone: '+27821234567',
        name: 'Alice',
        email: null,
      })
    mockDb.customer.update.mockResolvedValue({
      id: 'cust-db-id',
      userId: 'customer-uid',
      phone: '+27821234567',
      name: 'Alice',
      email: null,
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: {
              customer: { id: 'cust-db-id' },
            },
          },
        },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(200)
    // Customer path must NOT query provider table
    expect(mockDb.provider.findUnique).not.toHaveBeenCalled()
  })

  it('denies an unauthenticated request', async () => {
    mockGetSession.mockResolvedValue(null)
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(401)
  })

  it('allows an unauthenticated request with a valid ticket token for the same job request', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveJobRequestAccessScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: {
              id: 'jr-1',
              customer: { id: 'cust-db-id' },
            },
          },
        },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-123'), { params: makeParams() })

    expect(res.status).toBe(200)
    expect(mockResolveJobRequestAccessScope).toHaveBeenCalledWith('token-123')
    expect(mockHead).toHaveBeenCalledWith('https://blob.example.com/att-1')
  })

  it('allows a valid ticket token to load a customer photo linked directly to that request', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveJobRequestAccessScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      jobRequest: {
        id: 'jr-1',
        customer: { id: 'cust-db-id' },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-123'), { params: makeParams() })

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith('https://blob.example.com/download/att-1')
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('denies an unauthenticated request when the ticket token does not match the attachment job request', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveJobRequestAccessScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-2',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: {
              id: 'jr-1',
              customer: { id: 'cust-db-id' },
            },
          },
        },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-123'), { params: makeParams() })

    expect(res.status).toBe(403)
  })

  it('denies an unauthenticated request with an expired ticket token', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveJobRequestAccessScope.mockResolvedValue({
      status: 'expired',
      jobRequestId: 'jr-1',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: {
              id: 'jr-1',
              customer: { id: 'cust-db-id' },
            },
          },
        },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-123'), { params: makeParams() })

    expect(res.status).toBe(401)
  })

  it('allows an unauthenticated request with a valid provider lead token for the same job request', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
      leadId: 'lead-1',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      jobRequest: {
        id: 'jr-1',
        customer: { id: 'cust-db-id' },
      },
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('lead-token-123'), { params: makeParams() })

    expect(res.status).toBe(200)
    expect(mockResolveProviderLeadAttachmentScope).toHaveBeenCalledWith('lead-token-123')
    expect(mockHead).toHaveBeenCalledWith('https://blob.example.com/att-1')
  })

  it('falls back to the stored attachment URL when blob metadata has no downloadUrl', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)
    mockHead.mockResolvedValue({})

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith('https://blob.example.com/att-1')
  })

  it('returns 401 when an unauthenticated request has an expired or invalid lead token', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'expired',
      jobRequestId: null,
      leadId: 'lead-1',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('expired-lead-token'), { params: makeParams() })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid or expired/i)
  })

  it('returns 403 when an unauthenticated request has a valid lead token scoped to a different job request', async () => {
    mockGetSession.mockResolvedValue(null)
    // token is valid but scoped to jr-2, not jr-1
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-2',
      leadId: 'lead-2',
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('valid-but-wrong-scope-token'), { params: makeParams() })

    expect(res.status).toBe(403)
  })

  it('returns 403 when a session-authenticated invited provider has an expired lead', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: 'VIEWED',
      expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
      jobRequest: { match: { status: 'OFFERED' } },
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(403)
  })

  it('returns a diagnostic error when the stored image file cannot be found', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)
    mockFetch.mockResolvedValue({
      ok: false,
      body: null,
      status: 404,
    })

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toEqual(
      expect.objectContaining({
        code: 'IMAGE_NOT_FOUND',
        attachmentId: 'att-1',
        traceId: expect.any(String),
      }),
    )
  })
})

// ─── G1 regression: safeForPreview enforcement for ticket-token access ─────────
// Ticket tokens (customer access links) must NOT serve safeForPreview=false
// request attachments. Only job attachments (work evidence) are exempt because
// those are post-acceptance by definition.
describe('GET /api/attachments/[id] — safeForPreview enforcement with ticket tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHead.mockResolvedValue({ downloadUrl: 'https://blob.example.com/download/att-1' })
    mockFetch.mockResolvedValue({ ok: true, body: null, status: 200 })
    mockResolveJobRequestAccessScope.mockResolvedValue({ status: 'active', jobRequestId: 'jr-1' })
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({ status: 'invalid', jobRequestId: null })
    mockDb.lead.findUnique.mockResolvedValue(null)
  })

  it('allows a ticket-token request for a safeForPreview=true request attachment', async () => {
    mockGetSession.mockResolvedValue(null)
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      safeForPreview: true,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-abc'), { params: makeParams() })

    expect(res.status).toBe(200)
  })

  it('blocks a ticket-token request for a safeForPreview=false request attachment (pre-acceptance)', async () => {
    mockGetSession.mockResolvedValue(null)
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      safeForPreview: false,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-abc'), { params: makeParams() })

    // safeForPreview=false on a request attachment must be blocked even with a valid ticket token
    expect(res.status).toBe(403)
  })

  it('allows a ticket-token request for a job attachment (work evidence) regardless of safeForPreview', async () => {
    // Job attachments are post-acceptance work evidence — always visible to the ticket holder
    mockGetSession.mockResolvedValue(null)
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      safeForPreview: false,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
          },
        },
      },
      jobRequest: null,
    })

    const GET = await getHandler()
    const res = await GET(makeTokenRequest('token-abc'), { params: makeParams() })

    // Post-acceptance work evidence is always accessible
    expect(res.status).toBe(200)
  })
})

// ─── G2 regression: safeForPreview enforcement for lead-token access ──────────
// Provider lead tokens (signed links) must NOT serve safeForPreview=false
// request attachments unless the provider has an accepted unlock (isAccepted=true).
// After acceptance the full request-level attachment set is allowed.
describe('GET /api/attachments/[id] — safeForPreview enforcement with lead tokens (CODEX-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHead.mockResolvedValue({ downloadUrl: 'https://blob.example.com/download/att-1' })
    mockFetch.mockResolvedValue({ ok: true, body: null, status: 200 })
    mockResolveJobRequestAccessScope.mockResolvedValue({ status: 'invalid', jobRequestId: null })
    mockDb.lead.findUnique.mockResolvedValue(null)
  })

  it('blocks a non-accepted lead-token request for a safeForPreview=false request attachment', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
      leadId: 'lead-1',
      isAccepted: false,
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      safeForPreview: false,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('lead-token-preview'), { params: makeParams() })

    // safeForPreview=false must be blocked for non-accepted provider lead tokens
    expect(res.status).toBe(403)
  })

  it('allows an accepted lead-token request for a safeForPreview=false request attachment', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
      leadId: 'lead-1',
      isAccepted: true,
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      safeForPreview: false,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('lead-token-accepted'), { params: makeParams() })

    // After acceptance the provider may access all request attachments
    expect(res.status).toBe(200)
  })

  it('allows a non-accepted lead-token request for a safeForPreview=true attachment', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
      leadId: 'lead-1',
      isAccepted: false,
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: null,
      safeForPreview: true,
      jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('lead-token-preview-safe'), { params: makeParams() })

    // safeForPreview=true is always accessible even before acceptance
    expect(res.status).toBe(200)
  })

  it('allows a non-accepted lead-token request for a job attachment (work evidence)', async () => {
    mockGetSession.mockResolvedValue(null)
    mockResolveProviderLeadAttachmentScope.mockResolvedValue({
      status: 'active',
      jobRequestId: 'jr-1',
      leadId: 'lead-1',
      isAccepted: false,
    })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      safeForPreview: false,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: { id: 'jr-1', customer: { id: 'cust-db-id' } },
          },
        },
      },
      jobRequest: null,
    })

    const GET = await getHandler()
    const res = await GET(makeLeadTokenRequest('lead-token-job-evidence'), { params: makeParams() })

    // Job attachments (work evidence) are always accessible via lead tokens
    expect(res.status).toBe(200)
  })
})
