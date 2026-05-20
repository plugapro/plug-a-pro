import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createJobRequest } from '@/lib/job-requests/create-job-request'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { getSession } from '@/lib/auth'
import { processQuoteDecision } from '@/lib/quotes'
import {
  getCustomerShortlistForRequest,
  selectProviderForCustomerRequest,
} from '@/lib/customer-shortlists'
import { resolveClientPwaDestination as resolveClientPwaDestinationFromLib } from '@/lib/client-pwa-destination'
import { resolveExtraWork } from '@/lib/jobs'

export type ClientDraftInput = {
  category: string
  title: string
  description?: string
  address?: {
    street: string
    suburb: string
    city: string
    province?: string
    postalCode?: string
  } | null
  schedule?: 'asap' | 'morning' | 'afternoon' | 'specific' | null
}

export async function createDraftRequest(input: ClientDraftInput): Promise<{ id: string; status: 'draft' }> {
  const session = await getSession()
  if (!session || session.role !== 'customer' || !session.phone) {
    throw new Error('Unauthorized')
  }
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) throw new Error('Customer not found')

  const request = await createJobRequest({
    userId: session.id,
    phone: session.phone,
    category: input.category,
    title: input.title,
    description: input.description ?? '',
    assignmentMode: 'OPS_REVIEW',
    deferMatchingModeSelection: true,
    street: input.address?.street ?? 'Unknown',
    addressLine1: input.address?.street ?? 'Unknown',
    addressLine2: null,
    complexName: null,
    unitNumber: null,
    accessNotes: null,
    suburb: input.address?.suburb ?? 'Unknown',
    region: input.address?.city ?? 'Unknown',
    city: input.address?.city ?? 'Unknown',
    province: input.address?.province ?? 'Gauteng',
    postalCode: input.address?.postalCode ?? null,
    locationNodeId: null,
    source: 'pwa',
    urgency: input.schedule ?? null,
    providerPreference: null,
    budgetPreference: null,
    maxCallOutFee: null,
    verifiedOnly: false,
  })

  return { id: request.jobRequestId, status: 'draft' }
}

export async function saveDraftRequest(
  id: string,
  patch: Partial<ClientDraftInput>,
): Promise<{ id: string; status: string; category: string; title: string; description: string | null }> {
  const data: Prisma.JobRequestUpdateInput = {}
  if (patch.category) data.category = patch.category
  if (patch.title) data.title = patch.title
  if (typeof patch.description === 'string') data.description = patch.description
  if (patch.schedule) data.urgency = patch.schedule

  const request = await db.jobRequest.update({
    where: { id },
    data,
    select: { id: true, status: true, category: true, title: true, description: true },
  })
  return request
}

export async function submitRequest(id: string): Promise<{ requestId: string; status: 'submitted' | 'matching' }> {
  const request = await db.jobRequest.update({
    where: { id },
    data: {
      status: 'MATCHING',
      submittedAt: new Date(),
    },
    select: { id: true },
  })
  return { requestId: request.id, status: 'matching' }
}

export async function getRequestForClient(id: string) {
  return db.jobRequest.findUnique({
    where: { id },
    include: {
      customer: true,
      match: {
        include: {
          provider: true,
          quotes: { orderBy: { createdAt: 'desc' } },
          booking: { include: { job: true } },
        },
      },
    },
  })
}

export async function getShortlistForRequest(id: string) {
  return getCustomerShortlistForRequest(id)
}

export async function selectProvider(requestId: string, providerId: string): Promise<{ status: 'provider_confirmation_pending' }> {
  const session = await getSession()
  if (!session || session.role !== 'customer') throw new Error('Unauthorized')
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) throw new Error('Customer not found')
  await selectProviderForCustomerRequest({ requestId, providerId, customerId: customer.id })
  return { status: 'provider_confirmation_pending' }
}

export async function approveQuote(quoteId: string): Promise<{ jobId: string; status: 'scheduled' }> {
  const session = await getSession()
  if (!session || session.role !== 'customer' || !session.phone) throw new Error('Unauthorized')
  const result = await processQuoteDecision(quoteId, 'approve', {
    verifyCustomerPhone: session.phone,
  })
  if ('error' in result || result.action !== 'approved') throw new Error('Quote not approved')
  const booking = await db.booking.findUnique({
    where: { id: result.bookingId },
    select: { job: { select: { id: true } } },
  })
  if (!booking?.job?.id) throw new Error('Job not found')
  return { jobId: booking.job.id, status: 'scheduled' }
}

export async function declineQuote(quoteId: string): Promise<{ status: 'declined' }> {
  const session = await getSession()
  if (!session || session.role !== 'customer' || !session.phone) throw new Error('Unauthorized')
  const result = await processQuoteDecision(quoteId, 'decline', {
    verifyCustomerPhone: session.phone,
  })
  if ('error' in result) throw new Error('Quote not declined')
  return { status: 'declined' }
}

export async function getJobForClient(id: string) {
  return db.job.findUnique({
    where: { id },
    include: {
      provider: true,
      booking: {
        include: {
          quote: true,
          match: { include: { jobRequest: true } },
        },
      },
      extras: { orderBy: { createdAt: 'desc' } },
      photos: { orderBy: { createdAt: 'asc' } },
      statusHistory: { orderBy: { timestamp: 'asc' } },
    },
  })
}

export async function approveExtraWork(_jobId: string, extraWorkId: string): Promise<void> {
  const extra = await db.extraWork.findUnique({ where: { id: extraWorkId } })
  if (!extra) throw new Error('Extra work not found')
  await resolveExtraWork({ approvalToken: extra.approvalToken, approved: true })
}

export async function declineExtraWork(_jobId: string, extraWorkId: string): Promise<void> {
  const extra = await db.extraWork.findUnique({ where: { id: extraWorkId } })
  if (!extra) throw new Error('Extra work not found')
  await resolveExtraWork({ approvalToken: extra.approvalToken, approved: false })
}

export async function submitJobReview(
  jobId: string,
  input: { rating: number; tags?: string[]; text?: string },
): Promise<void> {
  const session = await getSession()
  if (!session || session.role !== 'customer') throw new Error('Unauthorized')
  const customer = await resolveCustomerForSession(db, session)
  if (!customer) throw new Error('Customer not found')
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { booking: { include: { match: true } } },
  })
  if (!job?.booking?.match) throw new Error('Match not found')
  await db.review.upsert({
    where: { jobId_reviewerType: { jobId, reviewerType: 'CUSTOMER' } },
    update: {
      score: Math.max(1, Math.min(5, input.rating)),
      comment: [input.text?.trim(), input.tags?.length ? `Tags: ${input.tags.join(', ')}` : null]
        .filter(Boolean)
        .join('\n'),
    },
    create: {
      jobId,
      matchId: job.booking.match.id,
      reviewerType: 'CUSTOMER',
      customerId: customer.id,
      providerId: job.providerId,
      score: Math.max(1, Math.min(5, input.rating)),
      comment: [input.text?.trim(), input.tags?.length ? `Tags: ${input.tags.join(', ')}` : null]
        .filter(Boolean)
        .join('\n'),
    },
  })
}

export async function resolveClientPwaDestination(token: string): Promise<string> {
  const destination = await resolveClientPwaDestinationFromLib({ token })
  if (destination.screen === 'expired' || destination.accessLevel === 'expired') {
    throw new Error('TOKEN_EXPIRED')
  }
  if (destination.screen === 'invalid_link' || destination.accessLevel === 'invalid') {
    throw new Error('TOKEN_INVALID')
  }
  return destination.route
}

export async function getInvoiceByToken(token: string) {
  const destination = await resolveClientPwaDestinationFromLib({ token })
  if (!destination.request?.match?.booking?.id) return null
  const bookingId = destination.request.match.booking.id
  return db.invoice.findUnique({
    where: { bookingId },
    include: {
      booking: {
        include: {
          quote: true,
          match: { include: { provider: true, jobRequest: { include: { customer: true } } } },
        },
      },
    },
  })
}
