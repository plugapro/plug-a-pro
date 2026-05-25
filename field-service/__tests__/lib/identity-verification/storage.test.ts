import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPut, mockGet, mockCreateDocument } = vi.hoisted(() => ({
  mockPut: vi.fn(),
  mockGet: vi.fn(),
  mockCreateDocument: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: mockPut,
  get: mockGet,
  del: vi.fn(),
}))

vi.mock('../../../lib/db', () => ({
  db: {
    providerIdentityDocument: {
      create: mockCreateDocument,
    },
  },
}))

describe('identity document storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPut.mockResolvedValue({
      url: 'https://store.private.blob.vercel-storage.com/id.pdf',
      pathname: 'identity/ver-1/ID_FRONT.pdf',
    })
    mockCreateDocument.mockImplementation(async (args) => ({
      id: 'doc-1',
      ...args.data,
    }))
  })

  it('uploads identity documents to private Blob storage', async () => {
    const { uploadIdentityDocument } = await import('../../../lib/storage')

    await expect(
      uploadIdentityDocument({
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        file: new File(['%PDF- identity'], 'id.pdf', { type: 'application/pdf' }),
      }),
    ).resolves.toMatchObject({
      url: 'https://store.private.blob.vercel-storage.com/id.pdf',
      pathname: 'identity/ver-1/ID_FRONT.pdf',
    })

    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^identity\/ver-1\/ID_FRONT-\d+\.pdf$/),
      expect.any(File),
      {
        access: 'private',
        addRandomSuffix: true,
        contentType: 'application/pdf',
        cacheControlMaxAge: 60,
      },
    )
  })

  it('fetches identity documents from private Blob storage without cache', async () => {
    const { getIdentityDocument } = await import('../../../lib/storage')

    await getIdentityDocument('identity/ver-1/ID_FRONT.pdf')

    expect(mockGet).toHaveBeenCalledWith('identity/ver-1/ID_FRONT.pdf', {
      access: 'private',
      useCache: false,
    })
  })

  it('stores identity document metadata with a SHA-256 digest and retention date', async () => {
    const { storeIdentityDocument } = await import('../../../lib/identity-verification/storage')
    const now = new Date('2026-05-25T10:00:00.000Z')

    const result = await storeIdentityDocument({
      verificationId: 'ver-1',
      documentKind: 'PASSPORT_PHOTO_PAGE',
      file: new File(['%PDF- passport'], 'passport.pdf', { type: 'application/pdf' }),
      now,
    })

    expect(result).toMatchObject({ id: 'doc-1', verificationId: 'ver-1' })
    expect(mockCreateDocument).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        documentKind: 'PASSPORT_PHOTO_PAGE',
        blobKey: 'identity/ver-1/ID_FRONT.pdf',
        mimeType: 'application/pdf',
        sizeBytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        deleteAfter: new Date('2026-07-24T10:00:00.000Z'),
      }),
    })
  })

  it('classifies private Blob upload failures without writing a document record', async () => {
    const { storeIdentityDocument } = await import('../../../lib/identity-verification/storage')
    mockPut.mockRejectedValueOnce(new Error('blob service unavailable'))

    await expect(
      storeIdentityDocument({
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        file: new File(['%PDF- identity'], 'id.pdf', { type: 'application/pdf' }),
      }),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_STORAGE_UPLOAD_FAILED',
      operation: 'document_storage_upload',
    })

    expect(mockCreateDocument).not.toHaveBeenCalled()
  })

  it('classifies identity document metadata DB write failures after upload succeeds', async () => {
    const { storeIdentityDocument } = await import('../../../lib/identity-verification/storage')
    mockCreateDocument.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      storeIdentityDocument({
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        file: new File(['%PDF- identity'], 'id.pdf', { type: 'application/pdf' }),
      }),
    ).rejects.toMatchObject({
      code: 'VERIFICATION_DOCUMENT_DB_WRITE_FAILED',
      operation: 'verification_document_db_write',
    })
  })

  it('rejects files whose bytes do not match the declared MIME type', async () => {
    const { uploadIdentityDocument } = await import('../../../lib/storage')

    await expect(
      uploadIdentityDocument({
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        file: new File(['not a pdf'], 'id.pdf', { type: 'application/pdf' }),
      }),
    ).rejects.toThrow(/content does not match/i)
  })
})
