import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockPut, mockFetch } = vi.hoisted(() => ({
  mockDb: {
    attachment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
  mockPut: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('@vercel/blob', () => ({ put: mockPut }))
vi.stubGlobal('fetch', mockFetch)

import { downloadAndStoreWhatsAppMedia } from '../../lib/whatsapp-media'

describe('downloadAndStoreWhatsAppMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa-token'
    mockDb.attachment.findFirst.mockResolvedValue(null)
    mockDb.attachment.create.mockResolvedValue({ id: 'att-1' })
    mockPut.mockResolvedValue({
      url: 'https://blob.example/customer-photos/media.jpg',
      pathname: 'customer-photos/media.jpg',
    })
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
})
