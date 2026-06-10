'use server'

import type { Prisma, VerificationStatus } from '@prisma/client'
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
import { persistDiditDecision } from '@/lib/identity-verification/vendors/didit/persist'
import { sendText } from '@/lib/whatsapp'

const FLAG = 'admin.crud.verifications'
const REVIEW_ROLES = ['TRUST'] as const
const DIDIT_REFRESH_TERMINAL_STATUSES = new Set<VerificationStatus>([
  'PASSED',
  'FAILED',
  'NEEDS_MANUAL_REVIEW',
  'EXPIRED',
  'CANCELLED',
])

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
type RefreshDiditFailure =
  | 'feature_disabled'
  | 'invalid_input'
  | 'not_found'
  | 'not_didit'
  | 'no_didit_session'
  | 'refresh_failed'
type ApproveIdentityVerificationResult = {
  id: string
  status: string
  alreadyApproved?: boolean
}

export async function approveIdentityVerificationAction(input: ReviewInput) {
  const admin = await requireAdmin()
  const result = await crudAction<ReviewInput, ApproveIdentityVerificationResult>({
    entity: 'ProviderIdentityVerification',
    entityId: input.verificationId,
    action: 'provider_identity_verification.approve',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: ReviewSchema,
    input,
    reason: input.notes,
    run: async (data, tx) => {
      const current = await tx.providerIdentityVerification.findUnique({
        where: { id: data.verificationId },
        select: { id: true, status: true, decision: true },
      })
      if (current?.status === 'PASSED' && current.decision === 'PASS') {
        return { id: data.verificationId, status: 'PASSED', alreadyApproved: true }
      }

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
  if (result.ok && !result.data.alreadyApproved) {
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
  const preflight = await authorizeDiditAdminAction()
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

async function authorizeDiditAdminAction(): Promise<{ ok: true } | { ok: false; error: 'feature_disabled' }> {
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
  const preflight = await authorizeDiditAdminAction()
  if (!preflight.ok) return preflight

  const parsed = RefreshDiditSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' as const }

  const verification = await db.providerIdentityVerification.findUnique({
    where: { id: parsed.data.verificationId },
    select: {
      id: true,
      status: true,
      decision: true,
      sourceCheckProvider: true,
      vendorReference: true,
      livenessSessionReference: true,
      vendorWorkflowId: true,
    },
  })
  if (!verification) return { ok: false as const, error: 'not_found' as const }
  if (verification.sourceCheckProvider !== 'didit') {
    return { ok: false as const, error: 'not_didit' as const }
  }
  const diditSessionReference = verification.livenessSessionReference
    ?? (verification.vendorReference?.startsWith('didit-pre:') ? null : verification.vendorReference)

  if (!diditSessionReference) {
    return { ok: false as const, error: 'no_didit_session' as const }
  }

  const refreshed = await refreshDiditSession(diditSessionReference, {
    storedVendorWorkflowId: verification.vendorWorkflowId,
  })
  const shouldApplyVerdict =
    !DIDIT_REFRESH_TERMINAL_STATUSES.has(verification.status) &&
    Boolean(refreshed.normalized.result)

  const result = await crudAction<RefreshDiditInput, { id: string }>({
    entity: 'ProviderIdentityVerification',
    entityId: parsed.data.verificationId,
    action: 'provider_identity_verification.refresh_didit_session',
    requiredRole: [...REVIEW_ROLES],
    requiredFlag: FLAG,
    schema: RefreshDiditSchema,
    input: parsed.data,
    run: async (_data, tx) => {
      if (shouldApplyVerdict && refreshed.normalized.result) {
        // Thread the crudAction transaction client so the state transition,
        // Provider.kycStatus update and the audit-log writes are committed
        // atomically with the refresh action's audit row.
        await applyVendorVerdict(verification.id, refreshed.normalized.result, 'webhook', tx)
      }
      return { id: verification.id }
    },
  })

  if (!result.ok) return { ok: false as const, error: 'refresh_failed' as const }

  const post = await db.providerIdentityVerification.findUnique({
    where: { id: verification.id },
    select: { id: true, status: true, decision: true },
  })
  if (!post) return { ok: false as const, error: 'not_found' as const }

  try {
    await persistDiditDecision(verification.id, refreshed.raw, { source: 'admin_refresh' })
  } catch (error) {
    await logDiditPersistFailed({
      verificationId: verification.id,
      status: post.status,
      vendorReference: diditSessionReference,
      source: 'admin_refresh',
      error: errorMessage(error),
    })
  }

  revalidateVerificationPaths(input.verificationId)
  return { ok: true as const, status: post.status, decision: post.decision }
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
  const result = await refreshDiditSessionAction({ verificationId })
  const message = result.ok ? 'didit-refreshed' : diditRefreshFailureMessage(result.error)
  redirect(`/admin/verifications/${verificationId}?message=${message}`)
}

function diditRefreshFailureMessage(error: RefreshDiditFailure) {
  switch (error) {
    case 'feature_disabled':
      return 'didit-refresh-failed-feature-disabled'
    case 'invalid_input':
      return 'didit-refresh-failed-invalid-input'
    case 'not_found':
      return 'didit-refresh-failed-not-found'
    case 'not_didit':
      return 'didit-refresh-failed-not-didit'
    case 'no_didit_session':
      return 'didit-refresh-failed-no-session'
    case 'refresh_failed':
      return 'didit-refresh-failed'
  }
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
      providerApplication: { select: { phone: true } },
    },
  })

  const providerPhone =
    verification?.provider?.phone ?? verification?.providerApplication?.phone
  if (!verification || !providerPhone) return 'skipped'

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

async function logDiditPersistFailed(params: {
  verificationId: string
  status: VerificationStatus
  vendorReference: string | null
  source: 'admin_refresh' | 'webhook'
  error: string
}) {
  try {
    await db.providerVerificationEvent.create({
      data: {
        verificationId: params.verificationId,
        fromStatus: params.status,
        toStatus: params.status,
        reasonCode: 'DIDIT_PERSIST_FAILED',
        metadata: {
          source: params.source,
          error: params.error,
          vendorReference: params.vendorReference,
        } as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    console.error('[admin/verifications] failed to log Didit persistence failure', {
      verificationId: params.verificationId,
      vendorReference: params.vendorReference,
      error: errorMessage(error),
    })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
