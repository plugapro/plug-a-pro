import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireRoleApi, mockDb, mockGetIdentityDocument } = vi.hoisted(() => ({
  mockRequireRoleApi: vi.fn(),
  mockDb: {
    providerIdentityDocument: {
      findFirst: vi.fn(),
    },
    providerSensitiveDataAccessLog: {
      createMany: vi.fn(),
    },
  },
  mockGetIdentityDocument: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRoleApi: mockRequireRoleApi }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/storage', () => ({ getIdentityDocument: mockGetIdentityDocument }))

describe('GET /api/admin/verifications/[id]/document/[docId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRoleApi.mockResolvedValue({
      id: 'admin-user-1',
      adminRole: 'TRUST',
    })
    mockDb.providerIdentityDocument.findFirst.mockResolvedValue({
      id: 'doc-1',
      verificationId: 'ver-1',
      blobKey: 'identity/ver-1/ID_FRONT.pdf',
    })
    mockDb.providerSensitiveDataAccessLog.createMany.mockResolvedValue({ count: 2 })
    mockGetIdentityDocument.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('identity-doc'))
          controller.close()
        },
      }),
      blob: {
        contentType: 'application/pdf',
        size: 12,
        contentDisposition: 'inline; filename="identity-document.pdf"',
      },
    })
  })

  it('streams private identity documents only for TRUST-or-higher admins and logs access', async () => {
    const { GET } = await import('@/app/api/admin/verifications/[id]/document/[docId]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/admin/verifications/ver-1/document/doc-1', {
        headers: {
          'user-agent': 'vitest',
          'x-forwarded-for': '127.0.0.1',
        },
      }),
      { params: Promise.resolve({ id: 'ver-1', docId: 'doc-1' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockRequireRoleApi).toHaveBeenCalledWith(['TRUST'])
    expect(mockGetIdentityDocument).toHaveBeenCalledWith('identity/ver-1/ID_FRONT.pdf')
    expect(mockDb.providerSensitiveDataAccessLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ accessType: 'VIEW_DOC', actorId: 'admin-user-1' }),
        expect.objectContaining({ accessType: 'SIGNED_URL_ISSUED', actorId: 'admin-user-1' }),
      ],
    })
  })

  it('rejects OPS and unauthenticated callers before document lookup', async () => {
    mockRequireRoleApi.mockResolvedValue(new Response('Forbidden', { status: 403 }))

    const { GET } = await import('@/app/api/admin/verifications/[id]/document/[docId]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/admin/verifications/ver-1/document/doc-1'),
      { params: Promise.resolve({ id: 'ver-1', docId: 'doc-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockDb.providerIdentityDocument.findFirst).not.toHaveBeenCalled()
    expect(mockGetIdentityDocument).not.toHaveBeenCalled()
  })
})
