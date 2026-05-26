import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPut,
  mockGet,
  mockCreateClient,
  mockGetBucket,
  mockCreateBucket,
  mockFrom,
  mockUpload,
  mockDownload,
  mockCreateDocument,
} = vi.hoisted(() => ({
  mockPut: vi.fn(),
  mockGet: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGetBucket: vi.fn(),
  mockCreateBucket: vi.fn(),
  mockFrom: vi.fn(),
  mockUpload: vi.fn(),
  mockDownload: vi.fn(),
  mockCreateDocument: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: mockPut,
  get: mockGet,
  del: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
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
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    delete process.env.IDENTITY_DOCUMENT_BUCKET

    mockCreateClient.mockReturnValue({
      storage: {
        getBucket: mockGetBucket,
        createBucket: mockCreateBucket,
        from: mockFrom,
      },
    })
    mockGetBucket.mockResolvedValue({
      data: { name: 'identity-documents', public: false },
      error: null,
    })
    mockCreateBucket.mockResolvedValue({ data: { name: 'identity-documents' }, error: null })
    mockFrom.mockReturnValue({
      upload: mockUpload,
      download: mockDownload,
    })
    mockUpload.mockImplementation(async (path: string) => ({
      data: { path },
      error: null,
    }))
    mockDownload.mockResolvedValue({
      data: new Blob(['identity-doc'], { type: 'application/pdf' }),
      error: null,
    })
    mockPut.mockResolvedValue({
      url: 'https://store.private.blob.vercel-storage.com/id.pdf',
      pathname: 'identity/ver-1/ID_FRONT.pdf',
    })
    mockCreateDocument.mockImplementation(async (args) => ({
      id: 'doc-1',
      ...args.data,
    }))
  })

  it('uploads identity documents to a private Supabase Storage bucket', async () => {
    const { uploadIdentityDocument } = await import('../../../lib/storage')

    await expect(
      uploadIdentityDocument({
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        file: new File(['%PDF- identity'], 'id.pdf', { type: 'application/pdf' }),
      }),
    ).resolves.toMatchObject({
      url: null,
      pathname: expect.stringMatching(
        /^supabase:\/\/identity-documents\/identity\/ver-1\/ID_FRONT-\d+-[a-f0-9]{8}\.pdf$/,
      ),
    })

    expect(mockCreateClient).toHaveBeenCalledWith('https://supabase.test', 'service-role-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    expect(mockGetBucket).toHaveBeenCalledWith('identity-documents')
    expect(mockFrom).toHaveBeenCalledWith('identity-documents')
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^identity\/ver-1\/ID_FRONT-\d+-[a-f0-9]{8}\.pdf$/),
      expect.any(File),
      {
        contentType: 'application/pdf',
        cacheControl: '60',
        upsert: false,
      },
    )
  })

  it('creates the private Supabase bucket if it does not exist', async () => {
    const { uploadIdentityDocument } = await import('../../../lib/storage')
    mockGetBucket.mockResolvedValueOnce({
      data: null,
      error: { statusCode: '404', message: 'not found' },
    })

    await uploadIdentityDocument({
      verificationId: 'ver-1',
      documentKind: 'ID_FRONT',
      file: new File(['%PDF- identity'], 'id.pdf', { type: 'application/pdf' }),
    })

    expect(mockCreateBucket).toHaveBeenCalledWith('identity-documents', {
      public: false,
      allowedMimeTypes: expect.arrayContaining(['image/jpeg', 'application/pdf']),
      fileSizeLimit: String(10 * 1024 * 1024),
    })
  })

  it('rejects a public Supabase bucket for identity documents', async () => {
    const { uploadIdentityDocument } = await import('../../../lib/storage')
    mockGetBucket.mockResolvedValueOnce({
      data: { name: 'identity-documents', public: true },
      error: null,
    })

    await expect(
      uploadIdentityDocument({
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        file: new File(['%PDF- identity'], 'id.pdf', { type: 'application/pdf' }),
      }),
    ).rejects.toThrow(/must be private/i)

    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('fetches identity documents from private Supabase Storage', async () => {
    const { getIdentityDocument } = await import('../../../lib/storage')

    const result = await getIdentityDocument(
      'supabase://identity-documents/identity/ver-1/ID_FRONT.pdf',
    )

    expect(result).toMatchObject({
      statusCode: 200,
      blob: {
        contentType: 'application/pdf',
        size: 12,
        contentDisposition: 'inline; filename="ID_FRONT.pdf"',
      },
    })
    expect(mockFrom).toHaveBeenCalledWith('identity-documents')
    expect(mockDownload).toHaveBeenCalledWith('identity/ver-1/ID_FRONT.pdf')
  })

  it('keeps legacy Vercel Blob identity document reads available', async () => {
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
        blobKey: expect.stringMatching(
          /^supabase:\/\/identity-documents\/identity\/ver-1\/PASSPORT_PHOTO_PAGE-\d+-[a-f0-9]{8}\.pdf$/,
        ),
        mimeType: 'application/pdf',
        sizeBytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        deleteAfter: new Date('2026-07-24T10:00:00.000Z'),
      }),
    })
  })

  it('classifies private storage upload failures without writing a document record', async () => {
    const { storeIdentityDocument } = await import('../../../lib/identity-verification/storage')
    mockUpload.mockResolvedValueOnce({
      data: null,
      error: new Error('storage service unavailable'),
    })

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
