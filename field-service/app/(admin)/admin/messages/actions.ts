'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'
import type { TemplateName } from '@/lib/messaging-templates'
import type { WhatsAppComponent } from '@/lib/whatsapp'

const RETRY_FLAG = 'admin.crud.messages'
const OUTBOUND_FLAG = 'admin.messages.outbound'

const MAX_BROADCAST_RECIPIENTS = Number(process.env.BROADCAST_MAX_RECIPIENTS ?? '50')

// ─── Shared send helpers ──────────────────────────────────────────────────────

type SendableEvent = {
  id: string
  to: string
  templateName: string | null
  body: string | null
  metadata: Prisma.JsonValue
}

function extractBodyComponents(metadata: Prisma.JsonValue): WhatsAppComponent[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  const components = (metadata as Record<string, unknown>).bodyComponents
  return Array.isArray(components) ? (components as unknown as WhatsAppComponent[]) : []
}

/**
 * Attempt the actual WhatsApp send for a QUEUED MessageEvent row and mark it
 * SENT or FAILED. Never throws — the outcome is recorded on the row and
 * returned to the caller.
 *
 * Send strategy:
 *   1. templateName matches a registered template → sendTemplate with the
 *      bodyComponents recorded in metadata (works outside the 24h window).
 *   2. Otherwise, if a body exists → free-form sendText (only lands inside the
 *      24h window; an honest FAILED row is recorded when Meta rejects it).
 */
async function attemptWhatsappSend(event: SendableEvent): Promise<{ sent: boolean; failureReason?: string }> {
  try {
    const { sendTemplate, sendText } = await import('@/lib/whatsapp')
    const { TEMPLATES } = await import('@/lib/messaging-templates')

    let externalId: string
    if (event.templateName && event.templateName in TEMPLATES) {
      externalId = await sendTemplate({
        to: event.to,
        template: event.templateName as TemplateName,
        components: extractBodyComponents(event.metadata),
      })
    } else if (event.body) {
      externalId = await sendText({
        to: event.to,
        text: event.body,
        templateName: event.templateName ?? 'freeform:text',
        // This row IS the message event — don't let sendText create a second one.
        recordMessageEvent: false,
      })
    } else {
      throw new Error('Message has no registered template or body to re-send')
    }

    await db.messageEvent.updateMany({
      where: { id: event.id, status: 'QUEUED' },
      data: { status: 'SENT', externalId, sentAt: new Date(), failureReason: null },
    })
    return { sent: true }
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err)
    await db.messageEvent
      .updateMany({
        where: { id: event.id, status: 'QUEUED' },
        data: { status: 'FAILED', failureReason: failureReason.slice(0, 1000), sentAt: new Date() },
      })
      .catch(() => {})
    return { sent: false, failureReason }
  }
}

// ─── Retry ────────────────────────────────────────────────────────────────────

const RetryMessageSchema = z.object({
  messageId: z.string().min(1),
})

type RetryInput = z.infer<typeof RetryMessageSchema>

/**
 * AD-01: Retry re-sends the failed message inline.
 *
 * The FAILED row is preserved as history (status and failureReason untouched).
 * A NEW MessageEvent attempt row is created (metadata.retryOfId links it back)
 * and the send is attempted immediately: the new row ends up SENT or FAILED —
 * never a dangling QUEUED row that nothing consumes.
 */
export async function retryMessageAction(input: RetryInput) {
  const before = await db.messageEvent.findUnique({
    where: { id: input.messageId },
    select: { id: true, status: true, channel: true, to: true, failureReason: true },
  })

  let retryEvent: SendableEvent | null = null

  const result = await crudAction<RetryInput, { id: string; retryOfId: string }>({
    entity: 'MessageEvent',
    entityId: input.messageId,
    action: 'message.retry',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: RETRY_FLAG,
    schema: RetryMessageSchema,
    input,
    before: before ?? undefined,
    run: async (data, tx) => {
      const message = await tx.messageEvent.findUnique({
        where: { id: data.messageId },
        select: {
          id: true,
          status: true,
          channel: true,
          to: true,
          templateName: true,
          body: true,
          metadata: true,
          customerId: true,
          bookingId: true,
          providerId: true,
          leadId: true,
          isTestEvent: true,
          cohortName: true,
        },
      })
      if (!message) throw new CrudActionError('NOT_FOUND', `Message ${data.messageId} not found.`)
      if (message.status !== 'FAILED') {
        throw new CrudActionError('CONFLICT', `Cannot retry a ${message.status} message.`)
      }
      if (message.channel !== 'WHATSAPP') {
        throw new CrudActionError('CONFLICT', `Cannot retry a ${message.channel} message — only WhatsApp retries are supported.`)
      }

      const originalMetadata =
        message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
          ? (message.metadata as Prisma.JsonObject)
          : {}

      const attempt = await tx.messageEvent.create({
        data: {
          customerId: message.customerId,
          bookingId: message.bookingId,
          providerId: message.providerId,
          leadId: message.leadId,
          channel: message.channel,
          direction: 'OUTBOUND',
          templateName: message.templateName,
          body: message.body,
          to: message.to,
          status: 'QUEUED',
          isTestEvent: message.isTestEvent,
          cohortName: message.cohortName,
          metadata: {
            ...originalMetadata,
            retryOfId: message.id,
            adminRetry: true,
          } as Prisma.InputJsonValue,
        },
        select: { id: true, to: true, templateName: true, body: true, metadata: true },
      })

      retryEvent = attempt
      return { id: attempt.id, retryOfId: message.id }
    },
  })

  // Inline send — outside the audit transaction so a slow/failed Meta call
  // never rolls back the attempt record. The outcome lands on the new row.
  let sendOutcome: { sent: boolean; failureReason?: string } = { sent: false, failureReason: 'Send not attempted' }
  if (retryEvent) {
    sendOutcome = await attemptWhatsappSend(retryEvent)
  }

  revalidatePath('/admin/messages')
  return { ...result, sent: sendOutcome.sent, failureReason: sendOutcome.failureReason }
}

export async function retryMessageFromFormAction(formData: FormData) {
  try {
    return await retryMessageAction({
      messageId: formData.get('messageId') as string,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to retry message' }
  }
}

// ─── Send (single outbound) ───────────────────────────────────────────────────

const SendAdminWhatsappSchema = z.object({
  customerId: z.string().min(1),
  templateKey: z.string().min(1),
  bodyParams: z.array(z.string()).default([]),
})

type SendAdminWhatsappInput = z.infer<typeof SendAdminWhatsappSchema>

type WhatsappFireParams = {
  phone: string
  templateKey: TemplateName
  bodyComponents: WhatsAppComponent[]
  eventId: string
}

export async function sendAdminWhatsappAction(input: SendAdminWhatsappInput) {
  const { TEMPLATES } = await import('@/lib/messaging-templates')
  if (!(input.templateKey in TEMPLATES)) {
    return { ok: false as const, error: `Unknown template: ${input.templateKey}` }
  }

  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, phone: true, name: true },
  })
  if (!customer) return { ok: false as const, error: 'Customer not found' }

  const bodyComponents: WhatsAppComponent[] =
    input.bodyParams.length > 0
      ? [{ type: 'body', parameters: input.bodyParams.map((text) => ({ type: 'text' as const, text })) }]
      : []

  let fireParams: WhatsappFireParams | null = null

  const result = await crudAction<SendAdminWhatsappInput, { id: string }>({
    entity: AUDIT_ENTITY.CUSTOMER,
    entityId: input.customerId,
    action: 'message.admin_send',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: OUTBOUND_FLAG,
    schema: SendAdminWhatsappSchema,
    input,
    run: async (data, tx) => {
      const event = await tx.messageEvent.create({
        data: {
          customerId: data.customerId,
          channel: 'WHATSAPP',
          templateName: data.templateKey,
          to: customer.phone,
          status: 'QUEUED',
          metadata: JSON.parse(JSON.stringify({
            adminSend: true,
            adminCustomerId: data.customerId,
            // Persisted so a later Retry can reconstruct the exact send.
            bodyComponents,
          })) as Prisma.InputJsonValue,
        },
        select: { id: true },
      })
      fireParams = {
        phone: customer.phone,
        templateKey: data.templateKey as TemplateName,
        bodyComponents,
        eventId: event.id,
      }
      return { id: event.id }
    },
  })

  // Fire-and-forget: actually send via WhatsApp API and update event status
  if (fireParams) {
    const { phone, templateKey, bodyComponents: comps, eventId } = fireParams as WhatsappFireParams
    import('@/lib/whatsapp')
      .then(async ({ sendTemplate }) => {
        const externalId = await sendTemplate({ to: phone, template: templateKey, components: comps })
        await db.messageEvent.update({
          where: { id: eventId },
          data: { status: 'SENT', externalId, sentAt: new Date() },
        })
      })
      .catch(async () => {
        await db.messageEvent
          .update({ where: { id: eventId }, data: { status: 'FAILED', failureReason: 'Admin send failed' } })
          .catch(() => {})
      })
  }

  revalidatePath('/admin/messages')
  return result
}

export async function sendAdminWhatsappFromFormAction(formData: FormData) {
  try {
    const customerId = formData.get('customerId')
    if (typeof customerId !== 'string' || !customerId) {
      return { ok: false as const, error: 'Invalid customer ID' }
    }
    const templateKey = formData.get('templateKey')
    if (typeof templateKey !== 'string' || !templateKey) {
      return { ok: false as const, error: 'Template key is required' }
    }
    const rawParams = (formData.get('bodyParams') as string | null) ?? '[]'
    let bodyParams: string[]
    try {
      const parsed = JSON.parse(rawParams)
      bodyParams = Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return { ok: false as const, error: 'bodyParams must be a JSON array of strings' }
    }
    return await sendAdminWhatsappAction({ customerId, templateKey, bodyParams })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to send message' }
  }
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

const QueueBroadcastSchema = z.object({
  audienceType: z.enum(['active_customers', 'marketing_opt_in']),
  templateKey: z.string().min(1),
  bodyParams: z.array(z.string()).default([]),
})

type QueueBroadcastInput = z.infer<typeof QueueBroadcastSchema>

/**
 * AD-01: Broadcast sends inline. Nothing consumes QUEUED rows, so leaving them
 * queued was a silent no-op. The rows are created QUEUED inside the audited
 * transaction, then sent in a bounded loop (MAX_BROADCAST_RECIPIENTS cap) with
 * per-recipient error isolation — one bad number never aborts the batch, and
 * every row ends the action as SENT or FAILED.
 */
export async function queueBroadcastAction(input: QueueBroadcastInput) {
  const { TEMPLATES } = await import('@/lib/messaging-templates')
  if (!(input.templateKey in TEMPLATES)) {
    return { ok: false as const, error: `Unknown template: ${input.templateKey}` }
  }

  const bodyComponents: WhatsAppComponent[] =
    input.bodyParams.length > 0
      ? [{ type: 'body', parameters: input.bodyParams.map((text) => ({ type: 'text' as const, text })) }]
      : []

  let queuedEvents: SendableEvent[] = []

  const result = await crudAction<QueueBroadcastInput, { queued: number }>({
    entity: 'MessageEvent',
    action: 'message.broadcast_queue',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: OUTBOUND_FLAG,
    schema: QueueBroadcastSchema,
    input,
    run: async (data, tx) => {
      const customers = await tx.customer.findMany({
        where: {
          active: true,
          ...(data.audienceType === 'marketing_opt_in' ? { whatsappMarketingOptIn: true } : {}),
          phone: { not: '' },
          archivedAt: null,
        },
        select: { id: true, phone: true },
        take: MAX_BROADCAST_RECIPIENTS,
      })

      if (customers.length === 0) {
        throw new CrudActionError('CONFLICT', 'No eligible recipients found for this audience.')
      }

      const created: SendableEvent[] = []
      for (const c of customers) {
        const event = await tx.messageEvent.create({
          data: {
            customerId: c.id,
            channel: 'WHATSAPP',
            templateName: data.templateKey,
            to: c.phone,
            status: 'QUEUED',
            metadata: JSON.parse(JSON.stringify({
              broadcast: true,
              audienceType: data.audienceType,
              bodyComponents,
            })) as Prisma.InputJsonValue,
          },
          select: { id: true, to: true, templateName: true, body: true, metadata: true },
        })
        created.push(event)
      }

      queuedEvents = created
      return { queued: created.length }
    },
  })

  // Inline bounded send loop with per-recipient error isolation.
  let sent = 0
  let failed = 0
  for (const event of queuedEvents) {
    const outcome = await attemptWhatsappSend(event)
    if (outcome.sent) sent++
    else failed++
  }

  revalidatePath('/admin/messages')
  return { ...result, data: { ...result.data, sent, failed } }
}

export async function queueBroadcastFromFormAction(formData: FormData) {
  try {
    const audienceType = formData.get('audienceType')
    if (audienceType !== 'active_customers' && audienceType !== 'marketing_opt_in') {
      return { ok: false as const, error: 'Invalid audience type' }
    }
    const templateKey = formData.get('templateKey')
    if (typeof templateKey !== 'string' || !templateKey) {
      return { ok: false as const, error: 'Template key is required' }
    }
    const rawParams = (formData.get('bodyParams') as string | null) ?? '[]'
    let bodyParams: string[]
    try {
      const parsed = JSON.parse(rawParams)
      bodyParams = Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return { ok: false as const, error: 'bodyParams must be a JSON array of strings' }
    }
    return await queueBroadcastAction({ audienceType, templateKey, bodyParams })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to queue broadcast' }
  }
}
