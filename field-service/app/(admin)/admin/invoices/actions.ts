'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.invoices.actions'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const GenerateInvoiceSchema = z.object({
  bookingId: z.string().min(1),
})

const SendInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
})

const VoidInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type GenerateInput = z.infer<typeof GenerateInvoiceSchema>
type SendInput = z.infer<typeof SendInvoiceSchema>
type VoidInput = z.infer<typeof VoidInvoiceSchema>

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generateInvoiceAction(input: GenerateInput) {
  const result = await crudAction<GenerateInput, { id: string; pdfUrl: string }>({
    entity: AUDIT_ENTITY.INVOICE,
    action: 'invoice.generate',
    requiredRole: ['OPS', 'FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: GenerateInvoiceSchema,
    input,
    run: async (data, tx) => {
      // generateInvoicePdf uses the global db client and Vercel Blob (not tx) -
      // intentional: blob uploads cannot be rolled back anyway and the function is idempotent.
      const { generateInvoicePdf } = await import('@/lib/invoice/generate')
      const pdfUrl = await generateInvoicePdf(data.bookingId)
      // Use tx for the post-generation read to stay within the transaction snapshot.
      const invoice = await tx.invoice.findUnique({
        where: { bookingId: data.bookingId },
        select: { id: true },
      })
      return { id: invoice?.id ?? data.bookingId, pdfUrl }
    },
  })
  revalidatePath('/admin/invoices')
  return result
}

export async function generateInvoiceFromFormAction(formData: FormData) {
  try {
    const bookingId = formData.get('bookingId')
    if (typeof bookingId !== 'string' || !bookingId) {
      return { ok: false as const, error: 'Invalid booking ID' }
    }
    return await generateInvoiceAction({ bookingId })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to generate invoice' }
  }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

type WhatsappSendParams = {
  customerPhone: string
  customerFullName: string
  serviceLabel: string
  suburb: string
  city: string
  completionDate: string
  labourCost: string
  materialsCost: string
  totalAmount: string
  jobRef: string
  providerFullName: string
  jobId: string
}

export async function sendInvoiceAction(input: SendInput) {
  const before = await db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, number: true, pdfUrl: true, sentAt: true, totalAmount: true },
  })

  let whatsappParams: WhatsappSendParams | null = null

  const result = await crudAction<SendInput, { id: string; number: string }>({
    entity: AUDIT_ENTITY.INVOICE,
    entityId: input.invoiceId,
    action: 'invoice.send',
    requiredRole: ['OPS', 'FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: SendInvoiceSchema,
    input,
    before: before ?? undefined,
    run: async (data, tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        select: {
          id: true,
          number: true,
          pdfUrl: true,
          sentAt: true,
          totalAmount: true,
          booking: {
            select: {
              id: true,
              match: {
                select: {
                  jobRequest: {
                    select: {
                      title: true,
                      customer: { select: { phone: true, name: true } },
                      address: { select: { suburb: true, city: true } },
                    },
                  },
                  provider: { select: { name: true } },
                },
              },
              job: {
                select: { id: true, completedAt: true },
              },
              quote: {
                select: { labourCost: true, materialsCost: true },
              },
            },
          },
        },
      })

      if (!invoice) throw new CrudActionError('NOT_FOUND', `Invoice ${data.invoiceId} not found.`)
      if (invoice.sentAt) throw new CrudActionError('CONFLICT', 'Invoice already sent.')
      if (!invoice.pdfUrl) {
        throw new CrudActionError('CONFLICT', 'Generate the invoice PDF before sending.')
      }

      await tx.invoice.update({ where: { id: data.invoiceId }, data: { sentAt: new Date() } })

      const formatZar = (n: number) =>
        `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

      const job = invoice.booking.job
      const quote = invoice.booking.quote
      const jobRequest = invoice.booking.match.jobRequest

      whatsappParams = {
        customerPhone: jobRequest.customer.phone,
        customerFullName: jobRequest.customer.name,
        serviceLabel: jobRequest.title,
        suburb: jobRequest.address?.suburb ?? '',
        city: jobRequest.address?.city ?? '',
        completionDate: (job?.completedAt ?? new Date()).toLocaleDateString('en-ZA', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        labourCost: formatZar(Number(quote?.labourCost ?? 0)),
        materialsCost: formatZar(Number(quote?.materialsCost ?? 0)),
        totalAmount: formatZar(Number(invoice.totalAmount)),
        jobRef: invoice.booking.id.slice(-8).toUpperCase(),
        providerFullName: invoice.booking.match.provider.name,
        jobId: job?.id ?? invoice.booking.id,
      }

      return { id: invoice.id, number: invoice.number }
    },
  })

  // Best-effort WhatsApp notification - send outside the DB transaction
  if (whatsappParams) {
    const params = whatsappParams
    import('@/lib/whatsapp')
      .then(({ sendProviderInvoiceTemplate }) => sendProviderInvoiceTemplate(params))
      .catch(() => {})
  }

  revalidatePath('/admin/invoices')
  return result
}

export async function sendInvoiceFromFormAction(formData: FormData) {
  try {
    const invoiceId = formData.get('invoiceId')
    if (typeof invoiceId !== 'string' || !invoiceId) {
      return { ok: false as const, error: 'Invalid invoice ID' }
    }
    return await sendInvoiceAction({ invoiceId })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to send invoice' }
  }
}

// ─── Void ─────────────────────────────────────────────────────────────────────
// Invoice has no status field. Void = clear pdfUrl (marks invalid) + AuditLog record.

export async function voidInvoiceAction(input: VoidInput) {
  const before = await db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, number: true, pdfUrl: true, sentAt: true, totalAmount: true },
  })

  const result = await crudAction<VoidInput, { id: string; number: string }>({
    entity: AUDIT_ENTITY.INVOICE,
    entityId: input.invoiceId,
    action: 'invoice.void',
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: VoidInvoiceSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: data.invoiceId },
        select: { id: true, number: true },
      })
      if (!invoice) throw new CrudActionError('NOT_FOUND', `Invoice ${data.invoiceId} not found.`)

      await tx.invoice.update({ where: { id: data.invoiceId }, data: { pdfUrl: null } })

      return { id: invoice.id, number: invoice.number }
    },
  })
  revalidatePath('/admin/invoices')
  return result
}

export async function voidInvoiceFromFormAction(formData: FormData) {
  try {
    const invoiceId = formData.get('invoiceId')
    if (typeof invoiceId !== 'string' || !invoiceId) {
      return { ok: false as const, error: 'Invalid invoice ID' }
    }
    const reason = ((formData.get('reason') as string) ?? '').trim()
    if (!reason) return { ok: false as const, error: 'Reason is required' }
    return await voidInvoiceAction({ invoiceId, reason })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to void invoice' }
  }
}
