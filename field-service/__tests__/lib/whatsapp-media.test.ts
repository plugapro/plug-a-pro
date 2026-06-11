import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockPut, mockFetch, mockStoreIdentityDocument } = vi.hoisted(() => ({
  mockDb: {
    attachment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    // Run the callback against the same mockDb.attachment so count/create inside
    // the cap transaction hit the mocked methods.
    $transaction: vi.fn(),
  },
  mockPut: vi.fn(),
  mockFetch: vi.fn(),
  mockStoreIdentityDocument: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('@vercel/blob', () => ({ put: mockPut }))
vi.mock('../../lib/identity-verification/storage', () => ({
  storeIdentityDocument: mockStoreIdentityDocument,
}))
vi.stubGlobal('fetch', mockFetch)

import { downloadAndStoreWhatsAppIdentityDocument, downloadAndStoreWhatsAppMedia, MediaCapReachedError } from '../../lib/whatsapp-media'

describe('downloadAndStoreWhatsAppMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-token'
    mockDb.attachment.findFirst.mockResolvedValue(null)
    mockDb.attachment.create.mockResolvedValue({ id: 'att-1' })
    mockDb.attachment.count.mockResolvedValue(0)
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb))
    mockPut.mockResolvedValue({
      url: 'https://blob.example/customer-photos/media.jpg',
      pathname: 'customer-photos/media.jpg',
    })
    mockStoreIdentityDocument.mockResolvedValue({ id: 'identity-doc-1' })
  })

  it('downloads WhatsApp media and stores an app-controlled attachment record', async () => {
    const body = new Uint8Array([1, 2, 3, 4]).buffer
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.whatsapp.net/media-temp',
          mime_type: 'image/jpeg',
          file_size: 4,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => body,
      })

    const result = await downloadAndStoreWhatsAppMedia({
      mediaId: 'media-abc12345678',
      prefix: 'customer-photos',
      label: 'customer_photo',
      maxSizeBytes: 10,
    })

    expect(result).toEqual({ attachmentId: 'att-1' })
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v21.0/media-abc12345678',
      { headers: { Authorization: 'Bearer wa-token' } },
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://lookaside.whatsapp.net/media-temp',
      { headers: { Authorization: 'Bearer wa-token' } },
    )
    expect(mockPut).toHaveBeenCalledWith(
      'customer-photos/12345678.jpg',
      body,
      expect.objectContaining({
        access: 'public',
        addRandomSuffix: true,
        contentType: 'image/jpeg',
      }),
    )
    expect(mockDb.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        url: 'https://blob.example/customer-photos/media.jpg',
        blobKey: 'customer-photos/media.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 4,
        label: 'customer_photo',
        uploadedBy: 'system:whatsapp:media-abc12345678',
      }),
    })
  })

  it('stores actual buffer byte length, not Meta-reported file_size, in the attachment record', async () => {
    // Meta reports 999 bytes but the actual downloaded buffer is 4 bytes.
    // sizeBytes must reflect the ground truth (buffer.byteLength).
    const body = new Uint8Array([1, 2, 3, 4]).buffer
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.whatsapp.net/media-temp',
          mime_type: 'image/jpeg',
          file_size: 999,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => body,
      })

    await downloadAndStoreWhatsAppMedia({
      mediaId: 'media-sizecheck',
      label: 'customer_photo',
      maxSizeBytes: 10_000,
    })

    expect(mockDb.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sizeBytes: 4 }),
    })
  })

  it('reuses an existing attachment for duplicate WhatsApp media delivery', async () => {
    mockDb.attachment.findFirst.mockResolvedValue({ id: 'att-existing' })

    await expect(
      downloadAndStoreWhatsAppMedia({ mediaId: 'media-dup', label: 'customer_photo' }),
    ).resolves.toEqual({ attachmentId: 'att-existing' })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })

  it('rejects unsupported image types before storing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'https://lookaside.whatsapp.net/media-temp',
        mime_type: 'image/heic',
        file_size: 4,
      }),
    })

    await expect(
      downloadAndStoreWhatsAppMedia({ mediaId: 'media-heic', label: 'customer_photo' }),
    ).rejects.toThrow('Unsupported media type')

    expect(mockPut).not.toHaveBeenCalled()
    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })

  it('rejects media that exceeds the size limit before downloading or storing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'https://lookaside.whatsapp.net/media-temp',
        mime_type: 'image/jpeg',
        file_size: 20_000_000,
      }),
    })

    await expect(
      downloadAndStoreWhatsAppMedia({ mediaId: 'media-large', label: 'customer_photo', maxSizeBytes: 10_000_000 }),
    ).rejects.toThrow('File too large')

    // Must stop before binary download
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })

  it('throws and does not store when the downloaded binary is empty', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://lookaside.whatsapp.net/media-temp', mime_type: 'image/jpeg', file_size: 4 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      })

    await expect(
      downloadAndStoreWhatsAppMedia({ mediaId: 'media-empty', label: 'customer_photo' }),
    ).rejects.toThrow('empty file')

    expect(mockPut).not.toHaveBeenCalled()
    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })

  it('stores WhatsApp identity media through private identity-document storage, not generic attachments', async () => {
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0x00]).buffer
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.whatsapp.net/identity-doc',
          mime_type: 'image/jpeg',
          file_size: 4,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => body,
      })

    await expect(
      downloadAndStoreWhatsAppIdentityDocument({
        mediaId: 'media-id-doc',
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        maxSizeBytes: 10,
      }),
    ).resolves.toEqual({ documentId: 'identity-doc-1' })

    expect(mockStoreIdentityDocument).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      documentKind: 'ID_FRONT',
      file: expect.any(File),
    })
    const file = mockStoreIdentityDocument.mock.calls[0][0].file as File
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe(4)
    expect(file.name).toBe('ID_FRONT-a-id-doc.jpg')
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })

  it('stores WhatsApp PDF identity documents through private identity-document storage', async () => {
    const body = new TextEncoder().encode('%PDF- identity document').buffer
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.whatsapp.net/identity-doc-pdf',
          mime_type: 'application/pdf',
          file_size: 22,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => body,
      })

    await expect(
      downloadAndStoreWhatsAppIdentityDocument({
        mediaId: 'media-id-pdf',
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        maxSizeBytes: 100,
      }),
    ).resolves.toEqual({ documentId: 'identity-doc-1' })

    const file = mockStoreIdentityDocument.mock.calls[0][0].file as File
    expect(file.type).toBe('application/pdf')
    expect(file.size).toBe(body.byteLength)
    expect(file.name).toBe('ID_FRONT-a-id-pdf.pdf')
  })

  it('classifies WhatsApp metadata failures without leaking provider response bodies', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"token-secret-or-url"}}',
    })

    let thrown: unknown
    await downloadAndStoreWhatsAppIdentityDocument({
      mediaId: 'media-meta-fail',
      verificationId: 'ver-1',
      documentKind: 'ID_FRONT',
    }).catch((error) => {
      thrown = error
    })

    expect(thrown).toMatchObject({
      code: 'WHATSAPP_MEDIA_METADATA_FETCH_FAILED',
      operation: 'whatsapp_media_metadata_fetch',
      status: 401,
    })
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).not.toContain('token-secret-or-url')
    await expect(Promise.reject(thrown)).rejects.not.toThrow(/token-secret-or-url/)
  })

  it('classifies missing WhatsApp media IDs before calling Meta', async () => {
    await expect(
      downloadAndStoreWhatsAppIdentityDocument({
        mediaId: '',
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_MEDIA_ID_MISSING',
      operation: 'whatsapp_media_id_extract',
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('classifies WhatsApp media binary download failures without leaking media URLs', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://lookaside.whatsapp.net/private-media-url',
          mime_type: 'image/jpeg',
          file_size: 4,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 410,
        text: async () => 'expired',
      })

    let thrown: unknown
    await downloadAndStoreWhatsAppIdentityDocument({
      mediaId: 'media-download-fail',
      verificationId: 'ver-1',
      documentKind: 'ID_FRONT',
    }).catch((error) => {
      thrown = error
    })

    expect(thrown).toMatchObject({
      code: 'WHATSAPP_MEDIA_DOWNLOAD_FAILED',
      operation: 'whatsapp_media_download',
      status: 410,
    })
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).not.toContain('private-media-url')
  })

  it('classifies unsupported document MIME types before downloading the binary', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'https://lookaside.whatsapp.net/identity-doc-gif',
        mime_type: 'image/gif',
        file_size: 4,
      }),
    })

    await expect(
      downloadAndStoreWhatsAppIdentityDocument({
        mediaId: 'media-gif',
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT_MIME_TYPE',
      operation: 'document_mime_validation',
      mimeType: 'image/gif',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockStoreIdentityDocument).not.toHaveBeenCalled()
  })

  it('classifies oversized identity documents before downloading the binary', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        url: 'https://lookaside.whatsapp.net/identity-doc-large',
        mime_type: 'application/pdf',
        file_size: 20_000_000,
      }),
    })

    await expect(
      downloadAndStoreWhatsAppIdentityDocument({
        mediaId: 'media-large-doc',
        verificationId: 'ver-1',
        documentKind: 'ID_FRONT',
        maxSizeBytes: 10_000_000,
      }),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_FILE_TOO_LARGE',
      operation: 'document_size_validation',
      sizeBytes: 20_000_000,
      maxSizeBytes: 10_000_000,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockStoreIdentityDocument).not.toHaveBeenCalled()
  })

  // ─── Authoritative photo-cap (finding 09336394) ──────────────────────────────

  it('namespaces uploadedBy under the cap scope key when capScope is supplied', async () => {
    const body = new Uint8Array([1, 2, 3, 4]).buffer
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://lookaside.whatsapp.net/m', mime_type: 'image/jpeg', file_size: 4 }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => body })

    await downloadAndStoreWhatsAppMedia({
      mediaId: 'media-scoped-001',
      label: 'customer_photo',
      capScope: { scopeKey: 'system:whatsapp:cphoto:+27821234567', max: 5, where: { jobRequestId: null } },
    })

    expect(mockDb.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        uploadedBy: 'system:whatsapp:cphoto:+27821234567:media-scoped-001',
      }),
    })
  })

  it('counts only the conversation-scoped, unlinked rows when enforcing the cap', async () => {
    const body = new Uint8Array([1, 2, 3, 4]).buffer
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://lookaside.whatsapp.net/m', mime_type: 'image/jpeg', file_size: 4 }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => body })

    await downloadAndStoreWhatsAppMedia({
      mediaId: 'media-count-001',
      label: 'customer_photo',
      capScope: { scopeKey: 'system:whatsapp:cphoto:+27820000000', max: 5, where: { jobRequestId: null } },
    })

    expect(mockDb.attachment.count).toHaveBeenCalledWith({
      where: {
        uploadedBy: { startsWith: 'system:whatsapp:cphoto:+27820000000:' },
        label: 'customer_photo',
        jobRequestId: null,
      },
    })
  })

  it('rejects with MediaCapReachedError before downloading when the scope is already at the cap', async () => {
    mockDb.attachment.count.mockResolvedValue(5)

    await expect(
      downloadAndStoreWhatsAppMedia({
        mediaId: 'media-over-cap',
        label: 'customer_photo',
        capScope: { scopeKey: 'system:whatsapp:cphoto:+27821111111', max: 5, where: { jobRequestId: null } },
      }),
    ).rejects.toBeInstanceOf(MediaCapReachedError)

    // Fast-fails before any network/storage work and before creating a row.
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })

  it('rejects at the transaction insert boundary if a concurrent upload fills the last slot after the pre-check', async () => {
    const body = new Uint8Array([1, 2, 3, 4]).buffer
    // Pre-download check sees 4 (room for one), but by the time the insert tx
    // runs the authoritative count is 5 - the over-cap insert is rejected.
    mockDb.attachment.count.mockResolvedValueOnce(4).mockResolvedValueOnce(5)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://lookaside.whatsapp.net/m', mime_type: 'image/jpeg', file_size: 4 }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => body })

    await expect(
      downloadAndStoreWhatsAppMedia({
        mediaId: 'media-race-insert',
        label: 'customer_photo',
        capScope: { scopeKey: 'system:whatsapp:cphoto:+27822222222', max: 5, where: { jobRequestId: null } },
      }),
    ).rejects.toBeInstanceOf(MediaCapReachedError)

    expect(mockDb.attachment.create).not.toHaveBeenCalled()
  })
})
