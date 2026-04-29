'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { normalizePhone } from '@/lib/utils'
import {
  awardKycApprovedPromoCreditsInTransaction,
  evaluateAndAwardProviderProfileCompletionPromoCreditsInTransaction,
} from '@/lib/provider-promo-awards'
import type { KycStatus, ProviderStatus } from '@prisma/client'

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

const CreateProviderSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  email: z.string().email().optional().or(z.literal('')),
  experience: z.string().max(120).optional().or(z.literal('')),
  skills: z.string().optional().or(z.literal('')),
  serviceAreas: z.string().optional().or(z.literal('')),
})

const UpdateProviderProfileSchema = z.object({
  providerId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/),
  email: z.string().email().optional().or(z.literal('')),
  experience: z.string().max(120).optional().or(z.literal('')),
  skills: z.string().optional().or(z.literal('')),
  serviceAreas: z.string().optional().or(z.literal('')),
})

const SetProviderKycSchema = z.object({
  providerId: z.string().min(1),
  kycStatus: z.enum([
    'NOT_STARTED',
    'IN_PROGRESS',
    'SUBMITTED',
    'VERIFIED',
    'REJECTED',
    'EXPIRED',
  ]),
})

const AddProviderNoteSchema = z.object({
  providerId: z.string().min(1),
  body: z.string().min(1).max(2000),
  pinned: z.boolean().optional(),
})

const AddProviderStrikeSchema = z.object({
  providerId: z.string().min(1),
  body: z.string().min(1).max(2000),
  reasonCode: z.enum([
    'PROVIDER_STRIKE_LATE',
    'PROVIDER_STRIKE_COMPLAINT',
    'PROVIDER_STRIKE_NO_SHOW',
    'POLICY_VIOLATION',
    'ADMIN_CORRECTION',
  ]),
})

const VerifyCertificationSchema = z.object({
  certId: z.string().min(1),
  providerId: z.string().min(1),
})

const UpsertCertificationSchema = z.object({
  providerId: z.string().min(1),
  certId: z.string().optional(),
  name: z.string().min(1).max(120),
  issuingAuthority: z.string().max(120).optional().or(z.literal('')),
  certNumber: z.string().max(120).optional().or(z.literal('')),
  issuedAt: z.string().optional().or(z.literal('')),
  expiresAt: z.string().optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
})

const DeleteCertificationSchema = z.object({
  providerId: z.string().min(1),
  certId: z.string().min(1),
})

const UpsertEquipmentSchema = z.object({
  providerId: z.string().min(1),
  equipmentId: z.string().optional(),
  label: z.string().min(1).max(120),
  category: z.string().max(120).optional().or(z.literal('')),
  serialNumber: z.string().max(120).optional().or(z.literal('')),
})

const DeleteEquipmentSchema = z.object({
  providerId: z.string().min(1),
  equipmentId: z.string().min(1),
})

type SetStatusInput = z.infer<typeof SetProviderStatusSchema>
type CreateProviderInput = z.infer<typeof CreateProviderSchema>
type UpdateProviderProfileInput = z.infer<typeof UpdateProviderProfileSchema>
type SetProviderKycInput = z.infer<typeof SetProviderKycSchema>
type AddNoteInput = z.infer<typeof AddProviderNoteSchema>
type AddStrikeInput = z.infer<typeof AddProviderStrikeSchema>
type VerifyCertInput = z.infer<typeof VerifyCertificationSchema>
type UpsertCertificationInput = z.infer<typeof UpsertCertificationSchema>
type DeleteCertificationInput = z.infer<typeof DeleteCertificationSchema>
type UpsertEquipmentInput = z.infer<typeof UpsertEquipmentSchema>
type DeleteEquipmentInput = z.infer<typeof DeleteEquipmentSchema>

// ─── createProvider ───────────────────────────────────────────────────────────

export async function createProviderAction(input: CreateProviderInput) {
  const normalizedPhone = normalizePhone(input.phone)

  const result = await crudAction<CreateProviderInput, { id: string }>({
    entity: 'Provider',
    action: 'provider.create',
    requiredRole: [...OWNER_ROLES],
    requiredFlag: FLAG,
    schema: CreateProviderSchema,
    input: {
      ...input,
      phone: normalizedPhone,
    },
    run: async (data, tx) => {
      const existing = await tx.provider.findUnique({
        where: { phone: data.phone },
        select: { id: true },
      })
      if (existing) {
        throw new CrudActionError(
          'CONFLICT',
          `A provider with this phone already exists (ID: ${existing.id}). Open their profile to update or review their record.`
        )
      }

      const provider = await tx.provider.create({
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email || null,
          experience: data.experience || null,
          skills: data.skills
            ? data.skills.split(',').map((skill) => skill.trim()).filter(Boolean)
            : [],
          serviceAreas: data.serviceAreas
            ? data.serviceAreas.split(',').map((area) => area.trim()).filter(Boolean)
            : [],
          status: 'APPLICATION_PENDING',
          active: true,
          availableNow: true,
          verified: false,
        },
        select: { id: true },
      })

      return { id: provider.id }
    },
  })
  revalidatePath('/admin/providers')
  revalidatePath('/admin/technicians')
  return result
}

// ─── updateProviderProfile ───────────────────────────────────────────────────

export async function updateProviderProfileAction(input: UpdateProviderProfileInput) {
  const normalizedPhone = normalizePhone(input.phone)

  const result = await crudAction<UpdateProviderProfileInput, { id: string }>({
    entity: 'Provider',
    entityId: input.providerId,
    action: 'provider.update_profile',
    requiredRole: [...OPS_ROLES],
    requiredFlag: FLAG,
    schema: UpdateProviderProfileSchema,
    input: {
      ...input,
      phone: normalizedPhone,
    },
    run: async (data, tx) => {
      const provider = await tx.provider.findUnique({
        where: { id: data.providerId },
        select: { id: true },
      })
      if (!provider) throw new CrudActionError('NOT_FOUND', `Provider ${data.providerId} not found.`)

      const duplicate = await tx.provider.findUnique({
        where: { phone: data.phone },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== data.providerId) {
        throw new CrudActionError('CONFLICT', `Provider phone ${data.phone} already exists.`)
      }

      await tx.provider.update({
        where: { id: data.providerId },
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email || null,
          experience: data.experience || null,
          skills: data.skills
            ? data.skills.split(',').map((skill) => skill.trim()).filter(Boolean)
            : [],
          serviceAreas: data.serviceAreas
            ? data.serviceAreas.split(',').map((area) => area.trim()).filter(Boolean)
            : [],
        },
      })

      await evaluateAndAwardProviderProfileCompletionPromoCreditsInTransaction(
        tx,
        data.providerId,
        {
          referenceType: 'provider',
          referenceId: data.providerId,
        },
      )

      return { id: data.providerId }
    },
  })
  revalidatePath('/admin/providers')
  revalidatePath('/admin/technicians')
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

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
      const now = new Date()
      await tx.provider.update({
        where: { id: data.providerId },
        data: {
          status: data.status as ProviderStatus,
          active: data.status === 'ACTIVE',
          verified: data.status === 'ACTIVE' ? true : undefined,
          // Persist reason for suspended providers (30-day default window)
          suspendedReason: data.status === 'SUSPENDED' ? data.reason : data.status === 'ACTIVE' ? null : undefined,
          suspendedUntil: data.status === 'SUSPENDED'
            ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
            : data.status === 'ACTIVE' ? null : undefined,
          // Persist reason for archived/banned providers
          archiveReason: data.status === 'ARCHIVED' || data.status === 'BANNED' ? data.reason : undefined,
          archivedAt: data.status === 'ARCHIVED' || data.status === 'BANNED' ? now : undefined,
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
  const result = await crudAction<{ providerId: string }, { id: string }>({
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

// ─── reactivateProvider ───────────────────────────────────────────────────────

export async function reactivateProviderAction(providerId: string) {
  const result = await crudAction<{ providerId: string }, { id: string }>({
    entity: 'Provider',
    entityId: providerId,
    action: 'provider.reactivate',
    requiredRole: [...OPS_ROLES],
    requiredFlag: FLAG,
    schema: VerifyProviderSchema,
    input: { providerId },
    run: async (_data, tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: {
          status: 'ACTIVE',
          active: true,
          suspendedUntil: null,
          suspendedReason: null,
        },
      })
      return { id: providerId }
    },
  })
  revalidatePath('/admin/providers')
  revalidatePath('/admin/technicians')
  revalidatePath(`/admin/providers/${providerId}`)
  revalidatePath(`/admin/technicians/${providerId}`)
  return result
}

// ─── setProviderKyc ──────────────────────────────────────────────────────────

export async function setProviderKycAction(input: SetProviderKycInput) {
  const result = await crudAction<SetProviderKycInput, { id: string }>({
    entity: 'Provider',
    entityId: input.providerId,
    action: 'provider.set_kyc',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: SetProviderKycSchema,
    input,
    run: async (data, tx) => {
      await tx.provider.update({
        where: { id: data.providerId },
        data: { kycStatus: data.kycStatus as KycStatus },
      })
      if (data.kycStatus === 'VERIFIED') {
        await awardKycApprovedPromoCreditsInTransaction(tx, data.providerId, {
          referenceType: 'provider_kyc',
          referenceId: data.providerId,
        })
      }
      return { id: data.providerId }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

// ─── addProviderNote ──────────────────────────────────────────────────────────

export async function addProviderNoteAction(input: AddNoteInput) {
  const admin = await import('@/lib/auth').then((m) => m.requireAdmin())
  const authorId = admin.adminUserId ?? admin.id

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
          authorId,
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

export async function addProviderStrikeAction(input: AddStrikeInput) {
  const admin = await import('@/lib/auth').then((m) => m.requireAdmin())
  const authorId = admin.adminUserId ?? admin.id

  const result = await crudAction<AddStrikeInput, { id: string }>({
    entity: 'ProviderNote',
    action: 'provider.strike.add',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: AddProviderStrikeSchema,
    input,
    run: async (data, tx) => {
      const note = await tx.providerNote.create({
        data: {
          providerId: data.providerId,
          authorId,
          body: data.body,
          pinned: true,
          reasonCode: data.reasonCode,
          strikeDelta: 1,
        },
        select: { id: true },
      })

      await tx.provider.update({
        where: { id: data.providerId },
        data: {
          strikes: {
            increment: 1,
          },
        },
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
  const admin = await import('@/lib/auth').then((m) => m.requireAdmin())
  const verifierId = admin.adminUserId ?? admin.id

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
        data: { verifiedAt: new Date(), verifiedById: verifierId },
      })
      return { id: data.certId }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

// ─── upsertCertification ─────────────────────────────────────────────────────

export async function upsertCertificationAction(input: UpsertCertificationInput) {
  const result = await crudAction<UpsertCertificationInput, { id: string }>({
    entity: 'ProviderCertification',
    entityId: input.certId,
    action: input.certId ? 'provider.cert.update' : 'provider.cert.create',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: UpsertCertificationSchema,
    input,
    run: async (data, tx) => {
      const certification = data.certId
        ? await tx.providerCertification.update({
            where: { id: data.certId },
            data: {
              name: data.name,
              issuingAuthority: data.issuingAuthority || null,
              certNumber: data.certNumber || null,
              issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
              expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
              notes: data.notes || null,
            },
            select: { id: true },
          })
        : await tx.providerCertification.create({
            data: {
              providerId: data.providerId,
              name: data.name,
              issuingAuthority: data.issuingAuthority || null,
              certNumber: data.certNumber || null,
              issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
              expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
              notes: data.notes || null,
            },
            select: { id: true },
          })
      return { id: certification.id }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

export async function deleteCertificationAction(input: DeleteCertificationInput) {
  const result = await crudAction<DeleteCertificationInput, { id: string }>({
    entity: 'ProviderCertification',
    entityId: input.certId,
    action: 'provider.cert.delete',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: DeleteCertificationSchema,
    input,
    run: async (data, tx) => {
      await tx.providerCertification.delete({
        where: { id: data.certId },
      })
      return { id: data.certId }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

// ─── upsertEquipment ─────────────────────────────────────────────────────────

export async function upsertEquipmentAction(input: UpsertEquipmentInput) {
  const result = await crudAction<UpsertEquipmentInput, { id: string }>({
    entity: 'ProviderEquipment',
    entityId: input.equipmentId,
    action: input.equipmentId ? 'provider.equipment.update' : 'provider.equipment.create',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: UpsertEquipmentSchema,
    input,
    run: async (data, tx) => {
      const equipment = data.equipmentId
        ? await tx.providerEquipment.update({
            where: { id: data.equipmentId },
            data: {
              label: data.label,
              category: data.category || null,
              serialNumber: data.serialNumber || null,
            },
            select: { id: true },
          })
        : await tx.providerEquipment.create({
            data: {
              providerId: data.providerId,
              label: data.label,
              category: data.category || null,
              serialNumber: data.serialNumber || null,
            },
            select: { id: true },
          })
      return { id: equipment.id }
    },
  })
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}

export async function deleteEquipmentAction(input: DeleteEquipmentInput) {
  const result = await crudAction<DeleteEquipmentInput, { id: string }>({
    entity: 'ProviderEquipment',
    entityId: input.equipmentId,
    action: 'provider.equipment.delete',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: DeleteEquipmentSchema,
    input,
    run: async (data, tx) => {
      await tx.providerEquipment.update({
        where: { id: data.equipmentId },
        data: { active: false },
      })
      return { id: data.equipmentId }
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

export async function createProviderFromFormAction(formData: FormData) {
  try {
    return await createProviderAction({
      name: (formData.get('name') as string ?? '').trim(),
      phone: (formData.get('phone') as string ?? '').trim(),
      email: (formData.get('email') as string ?? '').trim(),
      experience: (formData.get('experience') as string ?? '').trim(),
      skills: (formData.get('skills') as string ?? '').trim(),
      serviceAreas: (formData.get('serviceAreas') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to create provider' }
  }
}

export async function updateProviderProfileFromFormAction(formData: FormData) {
  try {
    return await updateProviderProfileAction({
      providerId: formData.get('providerId') as string,
      name: (formData.get('name') as string ?? '').trim(),
      phone: (formData.get('phone') as string ?? '').trim(),
      email: (formData.get('email') as string ?? '').trim(),
      experience: (formData.get('experience') as string ?? '').trim(),
      skills: (formData.get('skills') as string ?? '').trim(),
      serviceAreas: (formData.get('serviceAreas') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to update provider profile' }
  }
}

export async function reactivateProviderFromFormAction(formData: FormData) {
  try {
    return await reactivateProviderAction(formData.get('providerId') as string)
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to reactivate provider' }
  }
}

export async function setProviderKycFromFormAction(formData: FormData) {
  try {
    return await setProviderKycAction({
      providerId: formData.get('providerId') as string,
      kycStatus: formData.get('kycStatus') as SetProviderKycInput['kycStatus'],
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to update KYC status' }
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

export async function addProviderStrikeFromFormAction(formData: FormData) {
  try {
    return await addProviderStrikeAction({
      providerId: formData.get('providerId') as string,
      body: (formData.get('body') as string ?? '').trim(),
      reasonCode: formData.get('reasonCode') as AddStrikeInput['reasonCode'],
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to add provider strike' }
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

export async function upsertCertificationFromFormAction(formData: FormData) {
  try {
    return await upsertCertificationAction({
      providerId: formData.get('providerId') as string,
      certId: ((formData.get('certId') as string) || '').trim() || undefined,
      name: (formData.get('name') as string ?? '').trim(),
      issuingAuthority: (formData.get('issuingAuthority') as string ?? '').trim(),
      certNumber: (formData.get('certNumber') as string ?? '').trim(),
      issuedAt: (formData.get('issuedAt') as string ?? '').trim(),
      expiresAt: (formData.get('expiresAt') as string ?? '').trim(),
      notes: (formData.get('notes') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to save certification' }
  }
}

export async function deleteCertificationFromFormAction(formData: FormData) {
  try {
    return await deleteCertificationAction({
      providerId: formData.get('providerId') as string,
      certId: formData.get('certId') as string,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to delete certification' }
  }
}

export async function upsertEquipmentFromFormAction(formData: FormData) {
  try {
    return await upsertEquipmentAction({
      providerId: formData.get('providerId') as string,
      equipmentId: ((formData.get('equipmentId') as string) || '').trim() || undefined,
      label: (formData.get('label') as string ?? '').trim(),
      category: (formData.get('category') as string ?? '').trim(),
      serialNumber: (formData.get('serialNumber') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to save equipment' }
  }
}

export async function deleteEquipmentFromFormAction(formData: FormData) {
  try {
    return await deleteEquipmentAction({
      providerId: formData.get('providerId') as string,
      equipmentId: formData.get('equipmentId') as string,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to delete equipment' }
  }
}
