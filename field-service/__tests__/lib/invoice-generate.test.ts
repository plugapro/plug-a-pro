import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInvoiceFindUnique,
  mockInvoiceUpsert,
  mockBookingFindUnique,
  mockBlobPut,
  mockRenderToBuffer,
} = vi.hoisted(() => ({
  mockInvoiceFindUnique: vi.fn(),
  mockInvoiceUpsert: vi.fn(),
  mockBookingFindUnique: vi.fn(),
  mockBlobPut: vi.fn(),
  mockRenderToBuffer: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    invoice: { findUnique: mockInvoiceFindUnique, upsert: mockInvoiceUpsert },
    booking: { findUnique: mockBookingFindUnique },
  },
}))

vi.mock('@vercel/blob', () => ({ put: mockBlobPut }))

vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: mockRenderToBuffer,
  Document: vi.fn(),
  Page: vi.fn(),
  Text: vi.fn(),
  View: vi.fn(),
  StyleSheet: { create: vi.fn(() => ({})) },
}))

vi.mock('@/lib/invoice/pdf', () => ({
  InvoiceDocument: vi.fn(() => null),
}))

import { generateInvoicePdf } from '@/lib/invoice/generate'

// ── Shared fixtures ──────────────────────────────────────────────────────────

const BOOKING_ID = 'bkg-abc12345'
const CACHED_URL = 'https://blob.vercel-storage.com/invoices/existing.pdf'
const BLOB_URL = 'https://blob.vercel-storage.com/invoices/bkg-abc12345/invoice-PAP-2026-ABC12345.pdf'

const FULL_BOOKING = {
  id: BOOKING_ID,
  scheduledDate: new Date('2026-05-21'),
  createdAt: new Date('2026-05-21'),
  match: {
    jobRequest: {
      title: 'Fix leaky tap',
      category: 'plumbing',
      customer: { name: 'Test Customer' },
    },
    provider: { name: 'Test Provider' },
  },
  quote: {
    amount: 1500,
    labourCost: 1200,
    materialsCost: 300,
  },
  job: null,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('generateInvoicePdf()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 1. Idempotency: cached URL returned without re-rendering
  it('returns cached URL when invoice already has a pdfUrl', async () => {
    mockInvoiceFindUnique.mockResolvedValue({ pdfUrl: CACHED_URL })

    const result = await generateInvoicePdf(BOOKING_ID)

    expect(result).toBe(CACHED_URL)
    expect(mockBookingFindUnique).not.toHaveBeenCalled()
    expect(mockRenderToBuffer).not.toHaveBeenCalled()
    expect(mockBlobPut).not.toHaveBeenCalled()
  })

  // 2. Booking not found
  it('throws when booking is not found', async () => {
    mockInvoiceFindUnique.mockResolvedValue(null)
    mockBookingFindUnique.mockResolvedValue(null)

    await expect(generateInvoicePdf(BOOKING_ID)).rejects.toThrow(/not found/i)
  })

  // 3. Booking has no quote
  it('throws when booking has no quote', async () => {
    mockInvoiceFindUnique.mockResolvedValue(null)
    mockBookingFindUnique.mockResolvedValue({ ...FULL_BOOKING, quote: null })

    await expect(generateInvoicePdf(BOOKING_ID)).rejects.toThrow(/no quote/i)
  })

  // 4. Happy path: renders, uploads, persists, returns blob URL
  it('renders PDF, uploads to blob, upserts invoice row and returns blob URL', async () => {
    mockInvoiceFindUnique.mockResolvedValue(null)
    mockBookingFindUnique.mockResolvedValue(FULL_BOOKING)
    mockRenderToBuffer.mockResolvedValue(Buffer.from('%PDF-test'))
    mockBlobPut.mockResolvedValue({ url: BLOB_URL })
    mockInvoiceUpsert.mockResolvedValue({})

    const result = await generateInvoicePdf(BOOKING_ID)

    // renderToBuffer called once
    expect(mockRenderToBuffer).toHaveBeenCalledTimes(1)

    // blob put called with correct key prefix, buffer and content type
    expect(mockBlobPut).toHaveBeenCalledWith(
      expect.stringMatching(/^invoices\/bkg-abc12345\//),
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf' }),
    )

    // upsert called with bookingId and pdfUrl in both create and update
    expect(mockInvoiceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: BOOKING_ID },
        create: expect.objectContaining({
          bookingId: BOOKING_ID,
          number: expect.stringMatching(/^PAP-\d{4}-ABC12345$/),
          pdfUrl: BLOB_URL,
          totalAmount: 1500,
        }),
        update: expect.objectContaining({ pdfUrl: BLOB_URL }),
      }),
    )

    // return value is the blob URL
    expect(result).toBe(BLOB_URL)
  })

  // 5. Invoice number format: PAP-{year}-{last8ofBookingIdUppercase}
  it('builds blob key with correctly formatted invoice number', async () => {
    mockInvoiceFindUnique.mockResolvedValue(null)
    mockBookingFindUnique.mockResolvedValue(FULL_BOOKING)
    mockRenderToBuffer.mockResolvedValue(Buffer.from('%PDF-test'))
    mockBlobPut.mockResolvedValue({ url: BLOB_URL })
    mockInvoiceUpsert.mockResolvedValue({})

    await generateInvoicePdf(BOOKING_ID)

    // Key must end with invoice-PAP-{year}-ABC12345.pdf
    const [calledKey] = mockBlobPut.mock.calls[0]
    expect(calledKey).toMatch(/invoice-PAP-\d{4}-ABC12345\.pdf$/)
  })

  // 6. Uses completedAt as service date when job is complete
  it('calls renderToBuffer when booking has a completed job with completedAt', async () => {
    const bookingWithCompletedJob = {
      ...FULL_BOOKING,
      job: { status: 'COMPLETED', completedAt: new Date('2026-05-19') },
    }

    mockInvoiceFindUnique.mockResolvedValue(null)
    mockBookingFindUnique.mockResolvedValue(bookingWithCompletedJob)
    mockRenderToBuffer.mockResolvedValue(Buffer.from('%PDF-test'))
    mockBlobPut.mockResolvedValue({ url: BLOB_URL })
    mockInvoiceUpsert.mockResolvedValue({})

    await generateInvoicePdf(BOOKING_ID)

    expect(mockRenderToBuffer).toHaveBeenCalledTimes(1)
    const renderedElement = mockRenderToBuffer.mock.calls[0][0]
    // completedAt is 2026-05-19 → locale-tolerant match
    expect(renderedElement.props.serviceDate).toMatch(/19.*May.*2026/)
  })
})
