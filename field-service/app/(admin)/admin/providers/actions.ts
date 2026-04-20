'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import type { ProviderStatus } from '@prisma/client'

const FLAG = 'admin.crud.providers'
const OPS_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const
const OWNER_ROLES = ['ADMIN', 'OWNER'] as const

// ─── Schemas ──────────────────────────────────────────────────────────────────

const SetProviderStatusSchema = z.object({
  providerId: z.string().min(1),
  status: z.enum(['APPLICATION_PENDING', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'BANNED']),
  reason: z.string().min(1).max(500),
})

const VerifyProviderSchema = z.object({
  providerId: z.string().min(1),
})

const AddProviderNoteSchema = z.object({
  providerId: z.string().min(1),
  body: z.string().min(1).max(2000),
  pinned: z.boolean().optional(),
})

const VerifyCertificationSchema = z.object({
  certId: z.string().min(1),
  providerId: z.string().min(1),
})

type SetStatusInput = z.infer<typeof SetProviderStatusSchema>
type AddNoteInput = z.infer<typeof AddProviderNoteSchema>
type VerifyCertInput = z.infer<typeof VerifyCertificationSchema>

// ─── setProviderStatus ────────────────────────────────────────────────────────

export async function setProviderStatusAction(input: SetStatusInput) {
  const result = await crudAction<SetStatusInput, { id: string }>({
    entity: 'Provider',
    entityId: input.providerId,
    action: `provider.status.${input.status.toLowerCase()}`,
    requiredRole: [...OPS_ROLES],
    requiredFlag: FLAG,
    schema: SetProviderStatusSchema,
    input,
    run: async (data, tx) => {
      const provider = await tx.provider.findUnique({
        where: { id: data.providerId },
        select: { id: true, status: true },
      })
      if (!provider) throw new CrudActionError('NOT_FOUND', `Provider ${data.providerId} not found.`)
      await tx.provider.update({
        where: { id: data.providerId },
        data: {
          status: data.status as ProviderStatus,
          active: data.status === 'ACTIVE',
          verified: data.status === 'ACTIVE' ? true : undefined,
        },
      })
      return { id: data.providerId }
    },
  })
  revalidatePath('/admin/providers')
  revalidatePath('/admin/technicians')
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

// ─── verifyProvider ───────────────────────────────────────────────────────────

export async function verifyProviderAction(providerId: string) {
  const result = await crudAction<{ id: string }, { id: string }>({
    entity: 'Provider',
    entityId: providerId,
    action: 'provider.verify',
    requiredRole: [...OPS_ROLES],
    requiredFlag: FLAG,
    schema: VerifyProviderSchema,
    input: { providerId },
    run: async (_data, tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: { verified: true, status: 'ACTIVE', active: true },
      })
      return { id: providerId }
    },
  })
  revalidatePath(`/admin/providers/${providerId}`)
  revalidatePath(`/admin/technicians/${providerId}`)
  return result
}

// ─── addProviderNote ──────────────────────────────────────────────────────────

export async function addProviderNoteAction(input: AddNoteInput) {
  const session = await import('@/lib/auth').then((m) => m.getSession())
  if (!session) throw new CrudActionError('UNAUTHENTICATED', 'Authentication required.')

  const result = await crudAction<AddNoteInput, { id: string }>({
    entity: 'ProviderNote',
    action: 'provider.note.add',
    requiredRole: [...OPS_ROLES],
    requiredFlag: FLAG,
    schema: AddProviderNoteSchema,
    input,
    run: async (data, tx) => {
      const note = await tx.providerNote.create({
        data: {
          providerId: data.providerId,
          authorId: session.id,
          body: data.body,
          pinned: data.pinned ?? false,
        },
        select: { id: true },
      })
      return { id: note.id }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

// ─── verifyCertification ──────────────────────────────────────────────────────

export async function verifyCertificationAction(input: VerifyCertInput) {
  const session = await import('@/lib/auth').then((m) => m.getSession())
  if (!session) throw new CrudActionError('UNAUTHENTICATED', 'Authentication required.')

  const result = await crudAction<VerifyCertInput, { id: string }>({
    entity: 'ProviderCertification',
    entityId: input.certId,
    action: 'provider.cert.verify',
    requiredRole: [...OPS_ROLES],
    requiredFlag: FLAG,
    schema: VerifyCertificationSchema,
    input,
    run: async (data, tx) => {
      await tx.providerCertification.update({
        where: { id: data.certId },
        data: { verifiedAt: new Date(), verifiedById: session.id },
      })
      return { id: data.certId }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

// ─── FormData wrappers ────────────────────────────────────────────────────────

export async function setProviderStatusFromFormAction(formData: FormData) {
  try {
    return await setProviderStatusAction({
      providerId: formData.get('providerId') as string,
      status: formData.get('status') as SetStatusInput['status'],
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to update status' }
  }
}

export async function addProviderNoteFromFormAction(formData: FormData) {
  try {
    return await addProviderNoteAction({
      providerId: formData.get('providerId') as string,
      body: (formData.get('body') as string ?? '').trim(),
      pinned: formData.get('pinned') === 'true',
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to add note' }
  }
}

export async function verifyCertificationFromFormAction(formData: FormData) {
  try {
    return await verifyCertificationAction({
      certId: formData.get('certId') as string,
      providerId: formData.get('providerId') as string,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to verify certification' }
  }
}
