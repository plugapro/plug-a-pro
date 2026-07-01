import type { MessageStatus, Prisma } from '@prisma/client'
import { db } from './db'
import { isCohortMismatch, isInternalTestPhone, testEventFields } from './internal-test-cohort'

const SENT_OR_BETTER: MessageStatus[] = ['SENT', 'DELIVERED', 'READ']

export async function logOutboundMessage(params: {
  bookingId?: string | null
  to: string
  templateName?: string | null
  body?: string | null
  externalId?: string | null
  metadata?: Record<string, unknown>
  isTestEvent?: boolean
  allowTestCohortOverride?: boolean
}) {
  const customer = await db.customer.findUnique({
    where: { phone: params.to },
    select: { id: true },
  }).catch(() => null)

  const metadata = params.metadata ?? {}
  const idempotencyKey =
    typeof metadata.idempotencyKey === 'string'
      ? metadata.idempotencyKey
      : undefined
  // Tier 1 funnel observability: populate the message_events providerId/leadId
  // FK columns from metadata so provider lead offers carry linkage. These are
  // FK columns, so only string values may be written; anything else is ignored.
  const providerId =
    typeof metadata.providerId === 'string' ? metadata.providerId : undefined
  const leadId =
    typeof metadata.leadId === 'string' ? metadata.leadId : undefined
  const hasExplicitCohortMarker =
    'isTestEvent' in metadata ||
    'isTestRequest' in metadata ||
    'isTestJob' in metadata ||
    'isTestLead' in metadata
  const inferredTestEvent =
    params.isTestEvent ??
    (hasExplicitCohortMarker
      ? Boolean(metadata.isTestEvent) ||
        Boolean(metadata.isTestRequest) ||
        Boolean(metadata.isTestJob) ||
        Boolean(metadata.isTestLead)
      : isInternalTestPhone(params.to))

  const recipientIsTest =
    typeof metadata.recipientIsTest === 'boolean'
      ? (metadata.recipientIsTest as boolean)
      : undefined
  const effectiveRecipientIsTest = recipientIsTest ?? isInternalTestPhone(params.to)

  if (isCohortMismatch({
    subjectIsTest: inferredTestEvent,
    recipientPhone: params.to,
    recipientIsTest,
    allowTestOverride: params.allowTestCohortOverride,
  })) {
    await db.messageEvent.create({
      data: {
        bookingId: params.bookingId ?? undefined,
        customerId: customer?.id,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: params.templateName ?? undefined,
        body: params.body ?? undefined,
        to: params.to,
        providerId,
        leadId,
        status: 'FAILED',
        idempotencyKey,
        failureReason: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
        metadata: {
          ...metadata,
          recipientIsTestUser: effectiveRecipientIsTest,
          blockedReason: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
        } as Prisma.InputJsonValue,
        ...testEventFields(inferredTestEvent),
      },
    })
    console.warn('[test-cohort] outbound WhatsApp blocked', {
      code: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
      to: params.to,
      templateName: params.templateName,
      subject_is_test: inferredTestEvent,
      recipient_is_test: effectiveRecipientIsTest,
      trace_id: metadata.traceId ?? metadata.trace_id ?? null,
    })
    throw new Error('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')
  }

  const event = await db.messageEvent.create({
    data: {
      bookingId: params.bookingId ?? undefined,
      customerId: customer?.id,
      channel: 'WHATSAPP',
      templateName: params.templateName ?? undefined,
      body: params.body ?? undefined,
      to: params.to,
      providerId,
      leadId,
      externalId: params.externalId ?? undefined,
      idempotencyKey,
      status: 'SENT',
      sentAt: new Date(),
      metadata: metadata as Prisma.InputJsonValue,
      ...testEventFields(inferredTestEvent),
    },
    select: { id: true },
  })
  return { id: event.id }
}

// Flip an attempt-first SENT event to FAILED once the send is known to have
// failed, so dedup/cap queries that exclude FAILED stop counting it.
export async function markOutboundMessageFailed(params: {
  eventId: string
  failureReason: string
}) {
  await db.messageEvent.update({
    where: { id: params.eventId },
    data: { status: 'FAILED', failureReason: params.failureReason },
  })
}

export async function hasSuccessfulMessageForBooking(params: {
  bookingId: string
  templateName: string
  since?: Date
}) {
  const existing = await db.messageEvent.findFirst({
    where: {
      bookingId: params.bookingId,
      templateName: params.templateName,
      status: { in: SENT_OR_BETTER },
      ...(params.since ? { createdAt: { gte: params.since } } : {}),
    },
    select: { id: true },
  })

  return Boolean(existing)
}

export async function hasSuccessfulMessageForRecipient(params: {
  to: string
  templateName: string
  metadataPath?: string[]
  metadataEquals?: string
  since?: Date
}) {
  const existing = await db.messageEvent.findFirst({
    where: {
      to: params.to,
      templateName: params.templateName,
      status: { in: SENT_OR_BETTER },
      ...(params.since ? { createdAt: { gte: params.since } } : {}),
      ...(params.metadataPath && params.metadataEquals
        ? {
            metadata: {
              path: params.metadataPath,
              equals: params.metadataEquals,
            },
          }
        : {}),
    },
    select: { id: true },
  })

  return Boolean(existing)
}
