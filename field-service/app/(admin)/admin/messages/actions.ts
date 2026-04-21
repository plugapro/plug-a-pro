'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.messages'

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
    requiredFlag: FLAG,
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
