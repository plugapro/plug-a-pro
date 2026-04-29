import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPut, mockGet } = vi.hoisted(() => ({
  mockPut: vi.fn(),
  mockGet: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: mockPut,
  get: mockGet,
  del: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {},
}))

describe('provider payment proof storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPut.mockResolvedValue({
      url: 'https://store.private.blob.vercel-storage.com/proof.pdf',
      pathname: 'provider-credit-payments/intent-1/proof.pdf',
    })
  })

  it('uploads payment proof to private Blob storage', async () => {
    const { uploadProviderPaymentProof } = await import('../../lib/storage')

    await expect(
      uploadProviderPaymentProof({
        paymentIntentId: 'intent-1',
        file: new File(['proof'], 'payment.pdf', { type: 'application/pdf' }),
      }),
    ).resolves.toBe('https://store.private.blob.vercel-storage.com/proof.pdf')

    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^provider-credit-payments\/intent-1\/\d+-proof\.pdf$/),
      expect.any(File),
      {
        access: 'private',
        addRandomSuffix: true,
        contentType: 'application/pdf',
        cacheControlMaxAge: 60,
      },
    )
  })

  it('fetches private payment proof with cache bypassed', async () => {
    const { getProviderPaymentProof } = await import('../../lib/storage')
    await getProviderPaymentProof('https://store.private.blob.vercel-storage.com/proof.pdf')

    expect(mockGet).toHaveBeenCalledWith(
      'https://store.private.blob.vercel-storage.com/proof.pdf',
      {
        access: 'private',
        useCache: false,
      },
    )
  })
})
