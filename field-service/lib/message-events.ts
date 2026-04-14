import type { MessageStatus } from '@prisma/client'
import { db } from './db'

const SENT_OR_BETTER: MessageStatus[] = ['SENT', 'DELIVERED', 'READ']

export async function logOutboundMessage(params: {
  bookingId?: string | null
  to: string
  templateName?: string | null
  body?: string | null
  externalId?: string | null
  metadata?: Record<string, unknown>
}) {
  const customer = await db.customer.findUnique({
    where: { phone: params.to },
    select: { id: true },
  }).catch(() => null)

  await db.messageEvent.create({
    data: {
      bookingId: params.bookingId ?? undefined,
      customerId: customer?.id,
      channel: 'WHATSAPP',
      templateName: params.templateName ?? undefined,
      body: params.body ?? undefined,
      to: params.to,
      externalId: params.externalId ?? undefined,
      status: 'SENT',
      sentAt: new Date(),
      metadata: (params.metadata ?? {}) as Record<string, never>,
    },
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
