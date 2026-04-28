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
