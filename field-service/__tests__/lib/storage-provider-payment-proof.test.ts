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
        file: new File(['%PDF- proof'], 'payment.pdf', { type: 'application/pdf' }),
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

  it('rejects files whose extension does not match the declared MIME type', async () => {
    const { uploadProviderPaymentProof } = await import('../../lib/storage')

    await expect(
      uploadProviderPaymentProof({
        paymentIntentId: 'intent-1',
        file: new File(['%PDF- proof'], 'payment.jpg', { type: 'application/pdf' }),
      }),
    ).rejects.toThrow(/extension not allowed/i)
  })

  it('rejects files whose bytes do not match the declared MIME type', async () => {
    const { uploadProviderPaymentProof } = await import('../../lib/storage')

    await expect(
      uploadProviderPaymentProof({
        paymentIntentId: 'intent-1',
        file: new File(['not a pdf'], 'payment.pdf', { type: 'application/pdf' }),
      }),
    ).rejects.toThrow(/content does not match/i)
  })

  it('allows HEIF upload URLs with matching HEIF extensions', async () => {
    const { getUploadUrl } = await import('../../lib/storage')

    await expect(
      getUploadUrl({
        filename: 'photo.heif',
        contentType: 'image/heif',
        path: 'jobs/job-1',
      }),
    ).resolves.toMatchObject({
      pathname: expect.stringMatching(/^jobs\/job-1\/\d+\.heif$/),
    })
  })
})
