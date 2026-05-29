'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin, requireRole } from '@/lib/auth'
import { estimateDiditCost } from '@/lib/commercial/didit-pricing'
import { crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { decryptIdentifier } from '@/lib/identity-verification/crypto'
import { issueProviderIdentityVerificationLink } from '@/lib/identity-verification/link'
import {
  applyVendorVerdict,
  submitVerificationForAutomation,
  transitionIdentityVerification,
} from '@/lib/identity-verification/orchestrator'
import {
  getDiditConfig,
  getDiditWorkflowId,
  type DiditWorkflowProfile,
} from '@/lib/identity-verification/vendors/didit/config'
import { refreshDiditSession } from '@/lib/identity-verification/vendors/didit/decision'
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

const IssueDiditLinkSchema = z.object({
  providerId: z.string().min(1),
  workflowProfile: z.enum(['KYC_BASIC', 'KYC_AUTHORITATIVE']).optional(),
})

type IssueDiditLinkInput = z.infer<typeof IssueDiditLinkSchema>

const RefreshDiditSchema = z.object({
  verificationId: z.string().min(1),
})

type RefreshDiditInput = z.infer<typeof RefreshDiditSchema>

/**
 * Admin issues a Didit onboarding link for a provider. Defaults to the
 * authoritative workflow so a successful Approved drives assuranceLevel:HIGH
 * (which the credit gate and selected-provider acceptance both require).
 *
 * This action only mints the internal verify link and stamps Didit-specific
 * fields on the verification row - it does NOT create the Didit session.
 * Consent must be recorded by the provider in the PWA before a session is
 * created (see startHostedVerificationFromConsent in
 * app/provider/verify/[token]/actions.ts).
 *
 * Auth: crudAction handles session + role checks internally (TRUST role,
 * admin.crud.verifications flag). Do not add a redundant requireAdmin()
 * call here - the API route at /api/provider-verifications already uses
 * requireAdminApi() for the HTTP boundary and the form-action path lands
 * directly in crudAction.
 */
export async function issueDiditOnboardingLinkAction(input: IssueDiditLinkInput) {
  const preflight = await authorizeDiditLinkIssue()
  if (!preflight.ok) return preflight

  // Two-phase pattern (mirrors retryIdentityVerificationWithVendorAction):
  //   1. Pre-flight: validate Didit config + issue the link OUTSIDE crudAction
  //      (issueProviderIdentityVerificationLink does not accept a tx and
  //      writes its own ProviderVerificationEvent for audit).
  //   2. crudAction wraps the Didit field stamping + AuditLog atomically.
  const profile: DiditWorkflowProfile = input.workflowProfile ?? 'KYC_AUTHORITATIVE'
  const config = getDiditConfig()
  if (!config.enabled) {
    return { ok: false as const, error: `Didit is not configured: ${config.reason}` }
  }

  const parsed = IssueDiditLinkSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: 'invalid_input' }
  }

  const workflowId = getDiditWorkflowId(profile)
  const cost = estimateDiditCost({ workflowProfile: profile })
  const link = await issueProviderIdentityVerificationLink({
    providerId: parsed.data.providerId,
    channel: 'ADMIN',
  })

  const result = await crudAction<IssueDiditLinkInput, { id: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: link.verificationId,
    action: 'provider_identity_verification.issue_didit_link',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: IssueDiditLinkSchema,
    input,
    run: async (_data, tx) => {
      await tx.providerIdentityVerification.update({
        where: { id: link.verificationId },
        data: {
          sourceCheckProvider: 'didit',
          vendorWorkflowId: workflowId,
          costEstimateCents: cost.centsUsd,
          costCurrency: 'USD',
        },
      })
      return { id: link.verificationId }
    },
  })

  if (result.ok) {
    revalidateVerificationPaths(link.verificationId)
  }
  return result.ok
    ? {
        ok: true as const,
        verificationId: link.verificationId,
        verificationUrl: link.verificationUrl,
        expiresAt: link.expiresAt.toISOString(),
      }
    : { ok: false as const }
}

async function authorizeDiditLinkIssue(): Promise<{ ok: true } | { ok: false; error: 'feature_disabled' }> {
  const admin = await requireRole([...REVIEW_ROLES])
  const enabled = await isEnabled(FLAG, { userId: admin.id })
  if (!enabled) return { ok: false, error: 'feature_disabled' }
  return { ok: true }
}

/**
 * Admin or system poll: fetches the latest Didit decision for a verification
 * that has a vendorReference (Didit session_id) and applies the verdict via
 * the same orchestrator path the webhook uses. Idempotent on terminal status.
 *
 * Auth: crudAction handles session + role checks internally. See
 * issueDiditOnboardingLinkAction for the rationale.
 */
export async function refreshDiditSessionAction(input: RefreshDiditInput) {
  const result = await crudAction<RefreshDiditInput, { id: string; status: string; decision: string | null }>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.refresh_didit_session',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: RefreshDiditSchema,
    input,
    run: async (data, tx) => {
      const verification = await tx.providerIdentityVerification.findUnique({
        where: { id: data.verificationId },
        select: {
          id: true,
          status: true,
          decision: true,
          sourceCheckProvider: true,
          vendorReference: true,
          vendorWorkflowId: true,
        },
      })
      if (!verification) throw new Error('Verification not found')
      if (verification.sourceCheckProvider !== 'didit') {
        throw new Error('Refresh action only supports Didit-sourced verifications')
      }
      if (!verification.vendorReference) {
        throw new Error('Verification has no Didit session_id to refresh against')
      }
      if (['PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(verification.status)) {
        // Already terminal - return existing snapshot, no Didit call needed.
        return {
          id: verification.id,
          status: verification.status,
          decision: verification.decision,
        }
      }

      const refreshed = await refreshDiditSession(verification.vendorReference, {
        storedVendorWorkflowId: verification.vendorWorkflowId,
      })

      if (refreshed.normalized.result) {
        // Thread the crudAction transaction client so the state transition,
        // Provider.kycStatus update and the audit-log writes are committed
        // atomically with the refresh action's audit row.
        await applyVendorVerdict(verification.id, refreshed.normalized.result, 'webhook', tx)
      }
      const post = await tx.providerIdentityVerification.findUniqueOrThrow({
        where: { id: verification.id },
        select: { id: true, status: true, decision: true },
      })
      return { id: post.id, status: post.status, decision: post.decision }
    },
  })

  if (result.ok) {
    revalidateVerificationPaths(input.verificationId)
  }
  return result.ok
    ? { ok: true as const, status: result.data.status, decision: result.data.decision }
    : { ok: false as const }
}

export async function issueDiditOnboardingLinkFormAction(formData: FormData) {
  const providerId = formData.get('providerId')?.toString() ?? ''
  const workflowProfile = (formData.get('workflowProfile')?.toString() ?? 'KYC_AUTHORITATIVE') as DiditWorkflowProfile
  const result = await issueDiditOnboardingLinkAction({ providerId, workflowProfile })
  const target = result.ok && result.verificationId
    ? `/admin/verifications/${result.verificationId}?message=didit-link-issued`
    : '/admin/verifications?message=didit-link-failed'
  redirect(target)
}

export async function refreshDiditSessionFormAction(formData: FormData) {
  const verificationId = formData.get('verificationId')?.toString() ?? ''
  await refreshDiditSessionAction({ verificationId })
  redirect(`/admin/verifications/${verificationId}?message=didit-refreshed`)
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
