'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { crudAction } from '@/lib/crud-action'
import { transitionIdentityVerification } from '@/lib/identity-verification/orchestrator'

const FLAG = 'admin.crud.verifications'
const REVIEW_ROLES = ['TRUST'] as const

const ReviewSchema = z.object({
  verificationId: z.string().min(1),
  notes: z.string().max(1_000).optional(),
  assuranceLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
})

type ReviewInput = z.infer<typeof ReviewSchema>

export async function approveIdentityVerificationAction(input: ReviewInput) {
  const admin = await requireAdmin()
  const result = await crudAction<ReviewInput, { id: string; status: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.approve',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: ReviewSchema,
    input,
    reason: input.notes,
    run: async (data, tx) => {
      const updated = await transitionIdentityVerification({
        verificationId: data.verificationId,
        toStatus: 'PASSED',
        decision: 'PASS',
        actorId: admin.adminUserId ?? admin.id,
        actorRole: admin.adminRole,
        metadata: { reviewedBy: admin.adminUserId ?? admin.id },
        data: {
          assuranceLevel: data.assuranceLevel ?? 'HIGH',
          reviewedById: admin.adminUserId ?? admin.id,
          reviewedAt: new Date(),
        },
      }, tx)
      await tx.providerVerificationReview.create({
        data: {
          verificationId: data.verificationId,
          reviewerId: admin.adminUserId ?? admin.id,
          decision: 'PASS',
          notes: data.notes?.trim() || null,
        },
      })
      return { id: data.verificationId, status: (updated as { status?: string }).status ?? 'PASSED' }
    },
  })

  revalidateVerificationPaths(input.verificationId)
  return { ok: result.ok }
}

export async function rejectIdentityVerificationAction(input: ReviewInput) {
  const admin = await requireAdmin()
  const result = await crudAction<ReviewInput, { id: string; status: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.reject',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: ReviewSchema,
    input,
    reason: input.notes,
    run: async (data, tx) => {
      const updated = await transitionIdentityVerification({
        verificationId: data.verificationId,
        toStatus: 'FAILED',
        decision: 'FAIL',
        reasonCode: 'ADMIN_REJECTED',
        actorId: admin.adminUserId ?? admin.id,
        actorRole: admin.adminRole,
        data: {
          reviewedById: admin.adminUserId ?? admin.id,
          reviewedAt: new Date(),
        },
      }, tx)
      await tx.providerVerificationReview.create({
        data: {
          verificationId: data.verificationId,
          reviewerId: admin.adminUserId ?? admin.id,
          decision: 'FAIL',
          notes: data.notes?.trim() || null,
        },
      })
      return { id: data.verificationId, status: (updated as { status?: string }).status ?? 'FAILED' }
    },
  })

  revalidateVerificationPaths(input.verificationId)
  return { ok: result.ok }
}

export async function requestIdentityVerificationRetryAction(input: ReviewInput) {
  const admin = await requireAdmin()
  const result = await crudAction<ReviewInput, { id: string; status: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.request_retry',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: ReviewSchema,
    input,
    reason: input.notes,
    run: async (data, tx) => {
      const updated = await transitionIdentityVerification({
        verificationId: data.verificationId,
        toStatus: 'RETRY_REQUIRED',
        decision: 'RETRY_REQUIRED',
        reasonCode: 'ADMIN_REQUESTED_RETRY',
        actorId: admin.adminUserId ?? admin.id,
        actorRole: admin.adminRole,
        data: {
          reviewedById: admin.adminUserId ?? admin.id,
          reviewedAt: new Date(),
        },
      }, tx)
      await tx.providerVerificationReview.create({
        data: {
          verificationId: data.verificationId,
          reviewerId: admin.adminUserId ?? admin.id,
          decision: 'RETRY_REQUIRED',
          notes: data.notes?.trim() || null,
        },
      })
      return { id: data.verificationId, status: (updated as { status?: string }).status ?? 'RETRY_REQUIRED' }
    },
  })

  revalidateVerificationPaths(input.verificationId)
  return { ok: result.ok }
}

export async function approveIdentityVerificationFormAction(formData: FormData) {
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  await approveIdentityVerificationAction({
    verificationId,
    notes: formData.get('notes')?.toString() ?? undefined,
    assuranceLevel: formData.get('assuranceLevel')?.toString() as ReviewInput['assuranceLevel'],
  })
  redirect(`/admin/verifications/${verificationId}?message=approved`)
}

export async function rejectIdentityVerificationFormAction(formData: FormData) {
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  await rejectIdentityVerificationAction({
    verificationId,
    notes: formData.get('notes')?.toString() ?? undefined,
  })
  redirect(`/admin/verifications/${verificationId}?message=rejected`)
}

export async function requestIdentityVerificationRetryFormAction(formData: FormData) {
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  await requestIdentityVerificationRetryAction({
    verificationId,
    notes: formData.get('notes')?.toString() ?? undefined,
  })
  redirect(`/admin/verifications/${verificationId}?message=retry`)
}

function revalidateVerificationPaths(verificationId: string) {
  revalidatePath('/admin/verifications')
  revalidatePath(`/admin/verifications/${verificationId}`)
}
