'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { mergeCustomers, purgeArchivedCustomer } from '@/lib/customer-lifecycle'

const FLAG = 'admin.crud.customers'
const READ_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const
const OWNER_ROLES = ['ADMIN', 'OWNER'] as const

// ─── Schemas ──────────────────────────────────────────────────────────────────

const BlockCustomerSchema = z.object({
  customerId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  email: z.string().email().optional().or(z.literal('')),
  channel: z.enum(['WHATSAPP', 'PWA', 'REFERRAL', 'IMPORT']).optional(),
  address: z.string().max(500).optional().or(z.literal('')),
})

const UpdateCustomerSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  email: z.string().email().optional().or(z.literal('')),
  channel: z.enum(['WHATSAPP', 'PWA', 'REFERRAL', 'IMPORT']).optional(),
  address: z.string().max(500).optional().or(z.literal('')),
})

const AddNoteSchema = z.object({
  customerId: z.string().min(1),
  body: z.string().min(1).max(2000),
  pinned: z.boolean().optional(),
})

const SuspendCustomerSchema = z.object({
  customerId: z.string().min(1),
  until: z.string().datetime(),
  reason: z.string().min(1).max(500),
})

const DeactivateCustomerSchema = z.object({
  customerId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const ClearCustomerSuspensionSchema = z.object({
  customerId: z.string().min(1),
})

const ArchiveCustomerSchema = z.object({
  customerId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const MergeCustomerSchema = z.object({
  sourceCustomerId: z.string().min(1),
  targetCustomerId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const PurgeCustomerSchema = z.object({
  customerId: z.string().min(1),
})

type CreateInput = z.infer<typeof CreateCustomerSchema>
type UpdateInput = z.infer<typeof UpdateCustomerSchema>
type BlockInput = z.infer<typeof BlockCustomerSchema>
type AddNoteInput = z.infer<typeof AddNoteSchema>
type SuspendInput = z.infer<typeof SuspendCustomerSchema>
type DeactivateInput = z.infer<typeof DeactivateCustomerSchema>
type ClearSuspensionInput = z.infer<typeof ClearCustomerSuspensionSchema>
type ArchiveInput = z.infer<typeof ArchiveCustomerSchema>
type MergeInput = z.infer<typeof MergeCustomerSchema>
type PurgeInput = z.infer<typeof PurgeCustomerSchema>

// ─── createCustomer ───────────────────────────────────────────────────────────

export async function createCustomerAction(input: CreateInput) {
  const normalizedPhone = input.phone.startsWith('+') ? input.phone : `+${input.phone}`

  const result = await crudAction<CreateInput, { id: string }>({
    entity: 'Customer',
    action: 'customer.create',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    schema: CreateCustomerSchema,
    input: {
      ...input,
      phone: normalizedPhone,
    },
    run: async (data, tx) => {
      const existing = await tx.customer.findUnique({
        where: { phone: data.phone },
        select: { id: true },
      })
      if (existing) {
        throw new CrudActionError('CONFLICT', `Customer phone ${data.phone} already exists.`)
      }

      const customer = await tx.customer.create({
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email || null,
          channel: data.channel ?? 'WHATSAPP',
          address: data.address || null,
        },
        select: { id: true },
      })

      return { id: customer.id }
    },
  })
  revalidatePath('/admin/customers')
  return result
}

// ─── updateCustomer ──────────────────────────────────────────────────────────

export async function updateCustomerAction(input: UpdateInput) {
  const normalizedPhone = input.phone.startsWith('+') ? input.phone : `+${input.phone}`

  const result = await crudAction<UpdateInput, { id: string }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.update',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    schema: UpdateCustomerSchema,
    input: {
      ...input,
      phone: normalizedPhone,
    },
    run: async (data, tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, phone: true },
      })
      if (!customer) throw new CrudActionError('NOT_FOUND', `Customer ${data.customerId} not found.`)

      const duplicate = await tx.customer.findUnique({
        where: { phone: data.phone },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== data.customerId) {
        throw new CrudActionError('CONFLICT', `Customer phone ${data.phone} already exists.`)
      }

      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email || null,
          channel: data.channel ?? 'WHATSAPP',
          address: data.address || null,
        },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

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
        data: { isBlocked: true, blockedReason: data.reason, blockedAt: new Date() },
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
  const admin = await import('@/lib/auth').then((m) => m.requireAdmin())
  const authorId = admin.adminUserId ?? admin.id

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
          authorId,
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

// ─── suspendCustomer ──────────────────────────────────────────────────────────

export async function suspendCustomerAction(input: SuspendInput) {
  const result = await crudAction<SuspendInput, { id: string }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.suspend',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    schema: SuspendCustomerSchema,
    input,
    run: async (data, tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true },
      })
      if (!customer) throw new CrudActionError('NOT_FOUND', `Customer ${data.customerId} not found.`)
      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          suspendedUntil: new Date(data.until),
          suspendedReason: data.reason,
        },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

// ─── clearCustomerSuspension ─────────────────────────────────────────────────

export async function clearCustomerSuspensionAction(input: ClearSuspensionInput) {
  const result = await crudAction<ClearSuspensionInput, { id: string }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.unsuspend',
    requiredRole: [...READ_ROLES],
    requiredFlag: FLAG,
    schema: ClearCustomerSuspensionSchema,
    input,
    run: async (data, tx) => {
      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          suspendedUntil: null,
          suspendedReason: null,
        },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
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
        data: { active: false, isBlocked: true, blockedReason: data.reason, blockedAt: new Date() },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

// ─── archiveCustomer ────────────────────────────────────────────────────────

export async function archiveCustomerAction(input: ArchiveInput) {
  const result = await crudAction<ArchiveInput, { id: string }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.archive',
    requiredRole: [...OWNER_ROLES],
    requiredFlag: FLAG,
    schema: ArchiveCustomerSchema,
    input,
    run: async (data, tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true },
      })
      if (!customer) throw new CrudActionError('NOT_FOUND', `Customer ${data.customerId} not found.`)
      const now = new Date()
      const purgeAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          archivedAt: now,
          archiveReason: data.reason,
          active: false,
          purgeAfter,
        },
      })
      return { id: data.customerId }
    },
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.customerId}`)
  return result
}

// ─── mergeCustomer ──────────────────────────────────────────────────────────

export async function mergeCustomerAction(input: MergeInput) {
  const admin = await import('@/lib/auth').then((m) => m.requireRole(['OWNER']))

  const result = await crudAction<MergeInput, { id: string; mergedSourceId: string; purgeAfter: Date }>({
    entity: 'Customer',
    entityId: input.targetCustomerId,
    action: 'customer.merge',
    requiredRole: ['OWNER'],
    requiredFlag: FLAG,
    schema: MergeCustomerSchema,
    input,
    run: async (data, tx) =>
      mergeCustomers(tx as any, {
        sourceCustomerId: data.sourceCustomerId,
        targetCustomerId: data.targetCustomerId,
        executedById: admin.adminUserId ?? admin.id,
        reason: data.reason,
      }),
  })
  revalidatePath('/admin/customers')
  revalidatePath(`/admin/customers/${input.sourceCustomerId}`)
  revalidatePath(`/admin/customers/${input.targetCustomerId}`)
  return result
}

// ─── purgeCustomer ──────────────────────────────────────────────────────────

export async function purgeCustomerAction(input: PurgeInput) {
  const result = await crudAction<PurgeInput, { id: string; purged: true }>({
    entity: 'Customer',
    entityId: input.customerId,
    action: 'customer.purge',
    requiredRole: ['OWNER'],
    requiredFlag: FLAG,
    schema: PurgeCustomerSchema,
    input,
    run: async (data, tx) => purgeArchivedCustomer(tx as any, { customerId: data.customerId }),
  })
  revalidatePath('/admin/customers')
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

export async function createCustomerFromFormAction(formData: FormData) {
  try {
    return await createCustomerAction({
      name: (formData.get('name') as string ?? '').trim(),
      phone: (formData.get('phone') as string ?? '').trim(),
      email: (formData.get('email') as string ?? '').trim(),
      channel: (formData.get('channel') as CreateInput['channel']) ?? 'WHATSAPP',
      address: (formData.get('address') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to create customer' }
  }
}

export async function updateCustomerFromFormAction(formData: FormData) {
  try {
    return await updateCustomerAction({
      customerId: formData.get('customerId') as string,
      name: (formData.get('name') as string ?? '').trim(),
      phone: (formData.get('phone') as string ?? '').trim(),
      email: (formData.get('email') as string ?? '').trim(),
      channel: (formData.get('channel') as UpdateInput['channel']) ?? 'WHATSAPP',
      address: (formData.get('address') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to update customer' }
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

export async function suspendCustomerFromFormAction(formData: FormData) {
  try {
    const untilValue = (formData.get('until') as string ?? '').trim()
    const until = untilValue ? new Date(untilValue).toISOString() : untilValue
    return await suspendCustomerAction({
      customerId: formData.get('customerId') as string,
      until,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to suspend customer' }
  }
}

export async function clearCustomerSuspensionFromFormAction(formData: FormData) {
  try {
    return await clearCustomerSuspensionAction({
      customerId: formData.get('customerId') as string,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to clear customer suspension' }
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

export async function archiveCustomerFromFormAction(formData: FormData) {
  try {
    return await archiveCustomerAction({
      customerId: formData.get('customerId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to archive customer' }
  }
}

export async function mergeCustomerFromFormAction(formData: FormData) {
  try {
    return await mergeCustomerAction({
      sourceCustomerId: formData.get('sourceCustomerId') as string,
      targetCustomerId: formData.get('targetCustomerId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: err instanceof Error ? err.message : 'Failed to merge customer' }
  }
}

export async function purgeCustomerFromFormAction(formData: FormData) {
  try {
    return await purgeCustomerAction({
      customerId: formData.get('customerId') as string,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: err instanceof Error ? err.message : 'Failed to purge customer' }
  }
}
