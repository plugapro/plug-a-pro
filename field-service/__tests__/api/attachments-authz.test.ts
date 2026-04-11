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
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    attachment: { findUnique: vi.fn() },
    provider: { findUnique: vi.fn() },
  },
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.stubGlobal('fetch', mockFetch)

// Dynamic import so mocks are set up before module loads
async function getHandler() {
  const mod = await import('../../app/api/attachments/[id]/route')
  return mod.GET
}

const makeRequest = () =>
  new NextRequest('http://localhost/api/attachments/att-1')

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
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
      status: 200,
    })
  })

  it('allows a provider whose Provider.id matches job.providerId', async () => {
    mockGetSession.mockResolvedValue({ id: 'supabase-uid', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-db-id' })
    mockDb.attachment.findUnique.mockResolvedValue(ATTACHMENT_JOB_PROVIDER)

    const GET = await getHandler()
    const res = await GET(makeRequest(), { params: makeParams() })

    expect(res.status).toBe(200)
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
    mockGetSession.mockResolvedValue({ id: 'customer-uid', role: 'customer' })
    mockDb.attachment.findUnique.mockResolvedValue({
      ...ATTACHMENT_JOB_PROVIDER,
      job: {
        providerId: 'provider-db-id',
        booking: {
          match: {
            jobRequest: {
              customer: { userId: 'customer-uid' },
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
})
