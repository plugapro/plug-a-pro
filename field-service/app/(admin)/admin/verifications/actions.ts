'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { decryptIdentifier } from '@/lib/identity-verification/crypto'
import {
  submitVerificationForAutomation,
  transitionIdentityVerification,
} from '@/lib/identity-verification/orchestrator'
import { sendText } from '@/lib/whatsapp'

const FLAG = 'admin.crud.verifications'
const REVIEW_ROLES = ['TRUST'] as const

const ReviewSchema = z.object({
  verificationId: z.string().min(1),
  notes: z.string().max(1_000).optional(),
  assuranceLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
})

type ReviewInput = z.infer<typeof ReviewSchema>

const RevealIdentifierSchema = z.object({
  verificationId: z.string().min(1),
})

type RevealIdentifierInput = z.infer<typeof RevealIdentifierSchema>

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
  let notification: IdentityApprovalNotificationResult = 'skipped'
  if (result.ok) {
    notification = await notifyProviderIdentityApproval(input.verificationId)
  }
  return { ok: result.ok, notification }
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

export async function retryIdentityVerificationWithVendorAction(input: ReviewInput) {
  const admin = await requireAdmin()
  const result = await crudAction<ReviewInput, { id: string; status: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.retry_with_vendor',
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
        reasonCode: 'ADMIN_RETRY_WITH_VENDOR',
        actorId: admin.adminUserId ?? admin.id,
        actorRole: admin.adminRole,
        metadata: { retryWithVendor: true },
        data: {
          vendorReference: null,
          livenessSessionReference: null,
          livenessSessionUrlEncrypted: null,
          livenessSessionExpiresAt: null,
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

  if (result.ok) {
    await submitVerificationForAutomation(input.verificationId)
  }
  revalidateVerificationPaths(input.verificationId)
  return { ok: result.ok }
}

export async function revealIdentityIdentifierAction(input: RevealIdentifierInput) {
  const admin = await requireAdmin()
  const result = await crudAction<RevealIdentifierInput, { identifier: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.reveal_identifier',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: RevealIdentifierSchema,
    input,
    run: async (data, tx) => {
      const verification = await tx.providerIdentityVerification.findUnique({
        where: { id: data.verificationId },
        select: { id: true, identifierEncrypted: true },
      })
      if (!verification?.identifierEncrypted) {
        throw new Error('No encrypted identifier is available for this verification.')
      }

      const identifier = decryptIdentifier(verification.identifierEncrypted)
      await tx.providerSensitiveDataAccessLog.create({
        data: {
          verificationId: data.verificationId,
          actorId: admin.adminUserId ?? admin.id,
          actorRole: admin.adminRole,
          accessType: 'REVEAL_IDENTIFIER',
        },
      })

      return { identifier }
    },
  })

  return { ok: result.ok, identifier: result.data.identifier }
}

export async function approveIdentityVerificationFormAction(formData: FormData) {
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  const result = await approveIdentityVerificationAction({
    verificationId,
    notes: formData.get('notes')?.toString() ?? undefined,
    assuranceLevel: formData.get('assuranceLevel')?.toString() as ReviewInput['assuranceLevel'],
  })
  const message =
    result.notification === 'failed'
      ? 'approved-notification-failed'
      : result.notification === 'skipped'
        ? 'approved-notification-skipped'
        : 'approved'
  redirect(`/admin/verifications/${verificationId}?message=${message}`)
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

export async function retryIdentityVerificationWithVendorFormAction(formData: FormData) {
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  await retryIdentityVerificationWithVendorAction({
    verificationId,
    notes: formData.get('notes')?.toString() ?? undefined,
  })
  redirect(`/admin/verifications/${verificationId}?message=vendor-retry`)
}

type IdentityApprovalNotificationResult = 'sent' | 'failed' | 'skipped'

function revalidateVerificationPaths(verificationId: string) {
  revalidatePath('/admin/verifications')
  revalidatePath(`/admin/verifications/${verificationId}`)
}

async function notifyProviderIdentityApproval(
  verificationId: string,
): Promise<IdentityApprovalNotificationResult> {
  const verification = await db.providerIdentityVerification.findUnique({
    where: { id: verificationId },
    select: {
      id: true,
      provider: { select: { id: true, name: true, phone: true } },
    },
  })

  const providerPhone = verification?.provider?.phone
  if (!providerPhone) return 'skipped'

  const body = 'Your identity verification is complete. Your profile has been updated.'
  const metadata = {
    verificationId,
    providerId: verification.provider?.id ?? null,
    source: 'admin_identity_verification_approval',
  }

  try {
    await sendText({
      to: providerPhone,
      text: body,
      templateName: 'identity_verification_approved',
      metadata,
    })
    return 'sent'
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error)
    console.warn('[admin/verifications] identity approval notification failed', {
      verificationId,
      providerId: verification.provider?.id ?? null,
      failureReason,
    })
    await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: 'identity_verification_approved',
        body,
        to: providerPhone,
        status: 'FAILED',
        failureReason,
        metadata,
      },
    }).catch(() => undefined)
    return 'failed'
  }
}
