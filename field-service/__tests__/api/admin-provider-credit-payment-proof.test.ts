import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireAdminApi, mockDb, mockGetProviderPaymentProof } = vi.hoisted(() => ({
  mockRequireAdminApi: vi.fn(),
  mockDb: {
    paymentIntent: {
      findUnique: vi.fn(),
    },
  },
  mockGetProviderPaymentProof: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAdminApi: mockRequireAdminApi }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/storage', () => ({ getProviderPaymentProof: mockGetProviderPaymentProof }))

describe('GET /api/admin/provider-credit-payments/[id]/proof', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdminApi.mockResolvedValue(null)
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      proofOfPaymentUrl: 'https://store.private.blob.vercel-storage.com/proof.pdf',
    })
    mockGetProviderPaymentProof.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('proof'))
          controller.close()
        },
      }),
      blob: {
        contentType: 'application/pdf',
        size: 5,
        contentDisposition: 'attachment; filename="proof.pdf"',
      },
    })
  })

  it('streams private proof through an authenticated admin route', async () => {
    const { GET } = await import('@/app/api/admin/provider-credit-payments/[id]/proof/route')
    const response = await GET(
      new NextRequest('http://localhost/api/admin/provider-credit-payments/intent-1/proof'),
      { params: Promise.resolve({ id: 'intent-1' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="proof.pdf"')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockGetProviderPaymentProof).toHaveBeenCalledWith(
      'https://store.private.blob.vercel-storage.com/proof.pdf',
    )
  })

  it('rejects unauthenticated admin proof access', async () => {
    mockRequireAdminApi.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
    }))

    const { GET } = await import('@/app/api/admin/provider-credit-payments/[id]/proof/route')
    const response = await GET(
      new NextRequest('http://localhost/api/admin/provider-credit-payments/intent-1/proof'),
      { params: Promise.resolve({ id: 'intent-1' }) },
    )

    expect(response.status).toBe(401)
    expect(mockDb.paymentIntent.findUnique).not.toHaveBeenCalled()
    expect(mockGetProviderPaymentProof).not.toHaveBeenCalled()
  })

  it('returns not found when the payment intent has no proof', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({ proofOfPaymentUrl: null })

    const { GET } = await import('@/app/api/admin/provider-credit-payments/[id]/proof/route')
    const response = await GET(
      new NextRequest('http://localhost/api/admin/provider-credit-payments/intent-1/proof'),
      { params: Promise.resolve({ id: 'intent-1' }) },
    )

    expect(response.status).toBe(404)
    expect(mockGetProviderPaymentProof).not.toHaveBeenCalled()
  })
})
