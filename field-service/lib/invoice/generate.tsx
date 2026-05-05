import { renderToBuffer } from '@react-pdf/renderer'
import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { InvoiceDocument } from './pdf'

function generateInvoiceNumber(bookingId: string): string {
  const suffix = bookingId.slice(-8).toUpperCase()
  const year = new Date().getFullYear()
  return `PAP-${year}-${suffix}`
}

export async function generateInvoicePdf(bookingId: string): Promise<string> {
  // ── Idempotent: return cached URL if already generated ─────────────────────
  const existing = await db.invoice.findUnique({
    where: { bookingId },
    select: { pdfUrl: true },
  })
  if (existing?.pdfUrl) return existing.pdfUrl

  // ── Fetch booking data ──────────────────────────────────────────────────────
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: { select: { name: true } },
            },
          },
          provider: { select: { name: true } },
        },
      },
      quote: {
        select: {
          amount: true,
          labourCost: true,
          materialsCost: true,
        },
      },
      job: {
        select: { status: true, completedAt: true },
      },
    },
  })

  if (!booking) throw new Error(`Booking ${bookingId} not found`)
  if (!booking.quote) throw new Error(`Booking ${bookingId} has no quote`)

  const { match, quote } = booking
  const jobRequest = match.jobRequest
  const customer = jobRequest.customer

  const labourCost   = Number(quote.labourCost ?? 0)
  const materialsCost = Number(quote.materialsCost ?? 0)
  const totalAmount  = Number(quote.amount)
  const serviceDate  = (booking.job?.completedAt ?? booking.scheduledDate ?? booking.createdAt)
    .toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

  const invoiceNumber = generateInvoiceNumber(bookingId)

  // ── Render PDF ──────────────────────────────────────────────────────────────
  const buffer = await renderToBuffer(
    <InvoiceDocument
      invoiceNumber={invoiceNumber}
      bookingRef={bookingId.slice(-8).toUpperCase()}
      serviceDate={serviceDate}
      jobTitle={jobRequest.title}
      category={jobRequest.category}
      providerName={match.provider.name}
      customerName={customer.name}
      labourCost={labourCost}
      materialsCost={materialsCost}
      totalAmount={totalAmount}
    />
  )

  // ── Upload to Blob ──────────────────────────────────────────────────────────
  const key = `invoices/${bookingId}/invoice-${invoiceNumber}.pdf`
  const blob = await put(key, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/pdf',
  })

  // ── Persist pdfUrl on Invoice row (upsert) ──────────────────────────────────
  await db.invoice.upsert({
    where: { bookingId },
    create: {
      bookingId,
      number: invoiceNumber,
      pdfUrl: blob.url,
      totalAmount,
      taxAmount: null,
    },
    update: { pdfUrl: blob.url },
  })

  return blob.url
}
