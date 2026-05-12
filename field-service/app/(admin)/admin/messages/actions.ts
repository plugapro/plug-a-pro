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

// ─── Retry ────────────────────────────────────────────────────────────────────

const RetryMessageSchema = z.object({
  messageId: z.string().min(1),
})

type RetryInput = z.infer<typeof RetryMessageSchema>

export async function retryMessageAction(input: RetryInput) {
  const before = await db.messageEvent.findUnique({
    where: { id: input.messageId },
    select: { id: true, status: true, channel: true, to: true },
  })

  const result = await crudAction<RetryInput, { id: string }>({
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
        select: { id: true, status: true },
      })
      if (!message) throw new CrudActionError('NOT_FOUND', `Message ${data.messageId} not found.`)
      if (message.status !== 'FAILED') {
        throw new CrudActionError('CONFLICT', `Cannot retry a ${message.status} message.`)
      }
      await tx.messageEvent.update({
        where: { id: data.messageId },
        data: {
          status: 'QUEUED',
          failureReason: null,
        },
      })
      return { id: data.messageId }
    },
  })
  revalidatePath('/admin/messages')
  return result
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
          metadata: { adminSend: true, adminCustomerId: data.customerId } as Prisma.InputJsonValue,
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

export async function queueBroadcastAction(input: QueueBroadcastInput) {
  const { TEMPLATES } = await import('@/lib/messaging-templates')
  if (!(input.templateKey in TEMPLATES)) {
    return { ok: false as const, error: `Unknown template: ${input.templateKey}` }
  }

  const bodyComponents: WhatsAppComponent[] =
    input.bodyParams.length > 0
      ? [{ type: 'body', parameters: input.bodyParams.map((text) => ({ type: 'text' as const, text })) }]
      : []

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

      await tx.messageEvent.createMany({
        data: customers.map((c) => ({
          customerId: c.id,
          channel: 'WHATSAPP' as const,
          templateName: data.templateKey,
          to: c.phone,
          status: 'QUEUED' as const,
          metadata: JSON.parse(JSON.stringify({
            broadcast: true,
            audienceType: data.audienceType,
            bodyComponents,
          })) as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      })

      return { queued: customers.length }
    },
  })

  revalidatePath('/admin/messages')
  return result
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
