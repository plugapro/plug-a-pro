'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'

const FLAG = 'admin.crud.customers'
const READ_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const
const OWNER_ROLES = ['ADMIN', 'OWNER'] as const

// ─── Schemas ──────────────────────────────────────────────────────────────────

const BlockCustomerSchema = z.object({
  customerId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const AddNoteSchema = z.object({
  customerId: z.string().min(1),
  body: z.string().min(1).max(2000),
  pinned: z.boolean().optional(),
})

const DeactivateCustomerSchema = z.object({
  customerId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type BlockInput = z.infer<typeof BlockCustomerSchema>
type AddNoteInput = z.infer<typeof AddNoteSchema>
type DeactivateInput = z.infer<typeof DeactivateCustomerSchema>

// ─── blockCustomer ────────────────────────────────────────────────────────────

export async function blockCustomerAction(input: BlockInput) {
  const result = await crudAction<BlockInput, { id: string }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.block',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    schema: BlockCustomerSchema,
    input,
    run: async (data, tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, isBlocked: true },
      })
      if (!customer) throw new CrudActionError('NOT_FOUND', `Customer ${data.customerId} not found.`)
      await tx.customer.update({
        where: { id: data.customerId },
        data: { isBlocked: true, notes: data.reason },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

// ─── unblockCustomer ──────────────────────────────────────────────────────────

export async function unblockCustomerAction(customerId: string) {
  const result = await crudAction<{ id: string }, { id: string }>({
    entity: 'Customer',
    entityId: customerId,
    action: 'customer.unblock',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    input: { id: customerId },
    run: async (_data, tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: { isBlocked: false },
      })
      return { id: customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${customerId}`)
  return result
}

// ─── addCustomerNote ──────────────────────────────────────────────────────────

export async function addCustomerNoteAction(input: AddNoteInput) {
  const session = await import('@/lib/auth').then((m) => m.getSession())
  if (!session) throw new CrudActionError('UNAUTHENTICATED', 'Authentication required.')

  const result = await crudAction<AddNoteInput, { id: string }>({
    entity: 'CustomerNote',
    action: 'customer.note.add',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    schema: AddNoteSchema,
    input,
    run: async (data, tx) => {
      const note = await tx.customerNote.create({
        data: {
          customerId: data.customerId,
          authorId: session.id,
          body: data.body,
          pinned: data.pinned ?? false,
        },
        select: { id: true },
      })
      return { id: note.id }
    },
  })
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

// ─── deactivateCustomer ───────────────────────────────────────────────────────

export async function deactivateCustomerAction(input: DeactivateInput) {
  const result = await crudAction<DeactivateInput, { id: string }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.deactivate',
    requiredRole: [...OWNER_ROLES],
    requiredFlag: FLAG,
    schema: DeactivateCustomerSchema,
    input,
    run: async (data, tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true },
      })
      if (!customer) throw new CrudActionError('NOT_FOUND', `Customer ${data.customerId} not found.`)
      await tx.customer.update({
        where: { id: data.customerId },
        data: { active: false, isBlocked: true, notes: data.reason },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

// ─── FormData wrappers ────────────────────────────────────────────────────────

export async function blockCustomerFromFormAction(formData: FormData) {
  try {
    return await blockCustomerAction({
      customerId: formData.get('customerId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to block customer' }
  }
}

export async function addCustomerNoteFromFormAction(formData: FormData) {
  try {
    return await addCustomerNoteAction({
      customerId: formData.get('customerId') as string,
      body: (formData.get('body') as string ?? '').trim(),
      pinned: formData.get('pinned') === 'true',
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to add note' }
  }
}

export async function deactivateCustomerFromFormAction(formData: FormData) {
  try {
    return await deactivateCustomerAction({
      customerId: formData.get('customerId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to deactivate customer' }
  }
}
