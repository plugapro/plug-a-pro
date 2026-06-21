import type { Prisma, KycStatus, VerificationAssuranceLevel } from '@prisma/client'
import { db } from '../db'
import { isEnabled } from '../flags'
import { getPublicAppUrl } from '../provider-credit-copy'
import { issueProviderVerificationToken } from '../provider-verification-token'
import { sendText } from '../whatsapp-interactive'
import { decryptIdentifier, encryptIdentifier } from './crypto'
import { logIdentityVerificationError, logIdentityVerificationEvent } from './log'
import type { VerificationDecision, VerificationStatus } from './types'
import { getAdapter, toVendorKey } from './vendors/registry'
import type { NormalizedVerificationResult, SubmitDocumentCheckInput, VendorKey } from './vendors/types'

const ALLOWED_TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  NOT_STARTED: ['STARTED'],
  STARTED: ['CONSENTED', 'CANCELLED', 'EXPIRED'],
  CONSENTED: ['AWAITING_IDENTIFIER', 'CANCELLED', 'EXPIRED'],
  AWAITING_IDENTIFIER: ['AWAITING_DOCUMENT', 'RETRY_REQUIRED', 'CANCELLED', 'EXPIRED'],
  AWAITING_DOCUMENT: ['AWAITING_SELFIE', 'RETRY_REQUIRED', 'CANCELLED', 'EXPIRED'],
  AWAITING_SELFIE: ['SUBMITTED', 'RETRY_REQUIRED', 'CANCELLED', 'EXPIRED'],
  SUBMITTED: ['PROCESSING', 'AWAITING_LIVENESS', 'NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED', 'RETRY_REQUIRED'],
  PROCESSING: ['AWAITING_LIVENESS', 'NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED', 'RETRY_REQUIRED'],
  AWAITING_LIVENESS: ['PROCESSING', 'NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED', 'RETRY_REQUIRED', 'EXPIRED', 'CANCELLED'],
  NEEDS_MANUAL_REVIEW: ['PASSED', 'FAILED', 'RETRY_REQUIRED', 'CANCELLED'],
  RETRY_REQUIRED: ['SUBMITTED', 'PROCESSING', 'AWAITING_LIVENESS', 'NEEDS_MANUAL_REVIEW', 'PASSED', 'FAILED', 'AWAITING_IDENTIFIER', 'AWAITING_DOCUMENT', 'AWAITING_SELFIE', 'CANCELLED', 'EXPIRED'],
  PASSED: ['EXPIRED'],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
}

type AutomationStatus = Extract<VerificationStatus, 'PROCESSING' | 'AWAITING_LIVENESS' | 'NEEDS_MANUAL_REVIEW' | 'PASSED' | 'FAILED'>

export type SubmitVerificationForAutomationResult = {
  verificationId: string
  status: VerificationStatus
  vendorKey: VendorKey
  vendorReference: string | null
  livenessUrl: string | null
  livenessSessionExpiresAt: Date | null
}

export type SubmitVerificationForAutomationOptions = {
  existingToken?: string
  refreshExpiredLiveness?: boolean
}

export type IdentityVerificationConsentVendor = {
  vendorKey: VendorKey
  vendorDisplayName: string
}

type IdentityVerificationClient = {
  providerIdentityVerification: {
    findUnique(args: {
      where: { id: string }
      select: { id: true; providerId: true; status: true; decision: true }
    }): Promise<{
      id: string
      providerId: string | null
      status: VerificationStatus
      decision: VerificationDecision | null
    } | null>
    update(args: {
      where: { id: string }
      data: Prisma.ProviderIdentityVerificationUpdateInput
    }): Promise<unknown>
  }
  providerVerificationEvent: {
    create(args: { data: Prisma.ProviderVerificationEventUncheckedCreateInput }): Promise<unknown>
  }
  provider: {
    update(args: { where: { id: string }; data: { kycStatus: KycStatus } }): Promise<unknown>
  }
}

export type TransitionIdentityVerificationInput = {
  verificationId: string
  toStatus: VerificationStatus
  decision?: VerificationDecision
  reasonCode?: string
  actorId?: string
  actorRole?: string
  metadata?: Record<string, unknown>
  data?: Prisma.ProviderIdentityVerificationUpdateInput
}

export class IdentityVerificationTransitionError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_TRANSITION',
    message: string,
  ) {
    super(message)
    this.name = 'IdentityVerificationTransitionError'
  }
}

export async function submitVerificationForAutomation(
  verificationId: string,
  client = db,
  options: SubmitVerificationForAutomationOptions = {},
): Promise<SubmitVerificationForAutomationResult> {
  const snapshot = await loadAutomationSnapshot(verificationId, client)

  if (options.refreshExpiredLiveness && shouldRefreshExpiredLiveness(snapshot)) {
    await transitionIdentityVerification({
      verificationId,
      toStatus: 'RETRY_REQUIRED',
      reasonCode: 'LIVENESS_SESSION_EXPIRED',
      metadata: { refreshExpiredLiveness: true },
      data: {
        vendorReference: null,
        livenessSessionReference: null,
        livenessSessionUrlEncrypted: null,
        livenessSessionExpiresAt: null,
      },
    }, client)
    return submitVerificationForAutomation(verificationId, client, {
      ...options,
      refreshExpiredLiveness: false,
    })
  }

  if (snapshot.vendorReference && ['PROCESSING', 'AWAITING_LIVENESS'].includes(snapshot.status)) {
    return automationResultFromSnapshot(snapshot, snapshot.sourceCheckProvider ?? 'manual')
  }

  if (!['SUBMITTED', 'RETRY_REQUIRED'].includes(snapshot.status) || snapshot.vendorReference) {
    return automationResultFromSnapshot(snapshot, snapshot.sourceCheckProvider ?? 'manual')
  }

  const activeConfig = await resolveActiveVendorConfig(snapshot, client)
  if (!hasConsentForVendor(snapshot, activeConfig.vendorKey)) {
    return transitionToManualReview(verificationId, 'PROVIDER_CONSENT_REQUIRED', {
      sourceCheckProvider: 'manual',
      vendorReference: null,
    }, client)
  }
  if (
    activeConfig.livenessRequired &&
    await isEnabled('provider.identity.verification.liveness.degraded_kill_switch', { userId: snapshot.providerId ?? undefined })
  ) {
    return transitionToManualReview(verificationId, 'PROVIDER_LIVENESS_UNAVAILABLE', {
      sourceCheckProvider: activeConfig.vendorKey,
      vendorReference: null,
    }, client)
  }
  let adapter
  try {
    adapter = getAdapter(activeConfig.vendorKey)
  } catch (error) {
    console.warn('[identity-verification] vendor adapter unavailable', {
      verificationId,
      vendorKey: activeConfig.vendorKey,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return transitionToManualReview(verificationId, 'PROVIDER_UNAVAILABLE', {
      sourceCheckProvider: activeConfig.vendorKey,
      vendorReference: null,
    }, client)
  }
  const identifierPlaintext = await revealIdentifierForSubmission(snapshot, client)
  const token = options.existingToken ?? (await issueProviderVerificationToken({ verificationId })).token
  const documentInput = buildSubmitDocumentInput(snapshot, activeConfig.vendorKey, identifierPlaintext, token)

  let submitResult
  let livenessResult: Awaited<ReturnType<NonNullable<typeof adapter.createLivenessSession>>> | null = null
  try {
    submitResult = await adapter.submitDocumentCheck(documentInput)
    const immediateNeedsLiveness =
      activeConfig.livenessRequired &&
      submitResult.immediateResult?.decision === 'PASS' &&
      submitResult.immediateResult.livenessVerified !== true
    if (activeConfig.livenessRequired && adapter.createLivenessSession && (!submitResult.immediateResult || immediateNeedsLiveness)) {
      livenessResult = await adapter.createLivenessSession({
        verificationId,
        providerId: snapshot.providerId,
        returnUrl: documentInput.livenessReturnUrl,
        submittedVendorReference: submitResult.vendorReference,
        webhookCallbackUrl: documentInput.webhookCallbackUrl,
      })
    }
  } catch (error) {
    console.warn('[identity-verification] vendor submission failed', {
      verificationId,
      vendorKey: activeConfig.vendorKey,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    return transitionToManualReview(verificationId, 'PROVIDER_UNAVAILABLE', {
      sourceCheckProvider: activeConfig.vendorKey,
      vendorReference: null,
    }, client)
  }

  const stamp = await client.providerIdentityVerification.updateMany({
    where: {
      id: verificationId,
      status: { in: ['SUBMITTED', 'RETRY_REQUIRED'] },
      vendorReference: null,
    },
    data: {
      sourceCheckProvider: activeConfig.vendorKey,
      vendorReference: submitResult.vendorReference,
      ...(livenessResult ? {
        livenessSessionReference: livenessResult.vendorReference,
        livenessSessionUrlEncrypted: encryptIdentifier(livenessResult.sessionUrl),
        livenessSessionExpiresAt: livenessResult.expiresAt,
      } : {}),
    },
  })

  if (stamp.count !== 1) {
    const current = await client.providerIdentityVerification.findUniqueOrThrow({
      where: { id: verificationId },
      select: { id: true, status: true, sourceCheckProvider: true, vendorReference: true, livenessSessionExpiresAt: true },
    })
    await client.providerVerificationEvent.create({
      data: {
        verificationId,
        fromStatus: current.status,
        toStatus: current.status,
        reasonCode: 'ORCHESTRATOR_CONTENTION',
        metadata: {
          orphanVendorKey: activeConfig.vendorKey,
          orphanVendorReference: submitResult.vendorReference,
          ...(livenessResult ? {
            orphanLivenessSessionReference: livenessResult.vendorReference,
            orphanLivenessSessionExpiresAt: livenessResult.expiresAt.toISOString(),
          } : {}),
        },
      },
    })
    // Best-effort cancel of the orphaned vendor job (and Smile Link, if any) from
    // contention loss. Without this, the losing process's link stays live until
    // its 60-minute TTL - risk: provider sees winner+loser URLs and clicks the
    // wrong one. adapter.cancelVerificationJob already swallows transport errors
    // and returns vendorAcknowledged:false on failure - no rethrow possible.
    if (livenessResult) {
      void adapter
        .cancelVerificationJob({
          verificationId,
          vendorReference: submitResult.vendorReference,
          livenessSessionReference: livenessResult.vendorReference,
          reason: 'ORCHESTRATOR_CONTENTION_ORPHAN',
        })
        .catch(() => {
          /* swallowed inside adapter; double-guard against an unexpected throw */
        })
    }
    return automationResultFromSnapshot(current, current.sourceCheckProvider ?? activeConfig.vendorKey)
  }

  if (livenessResult) {
    await transitionIdentityVerification({
      verificationId,
      toStatus: 'AWAITING_LIVENESS',
      metadata: {
        vendorKey: activeConfig.vendorKey,
        pendingPreLivenessDecision: submitResult.immediateResult?.decision ?? null,
      },
    }, client)
    return {
      verificationId,
      status: 'AWAITING_LIVENESS',
      vendorKey: activeConfig.vendorKey,
      vendorReference: submitResult.vendorReference,
      livenessUrl: getPublicAppUrl(`/provider/verify/${encodeURIComponent(token)}/liveness`) || null,
      livenessSessionExpiresAt: livenessResult.expiresAt,
    }
  }

  if (submitResult.immediateResult) {
    return applyVendorVerdict(verificationId, submitResult.immediateResult, 'sync', client)
  }

  await transitionIdentityVerification({
    verificationId,
    toStatus: 'PROCESSING',
    metadata: { vendorKey: activeConfig.vendorKey },
  }, client)

  return {
    verificationId,
    status: 'PROCESSING',
    vendorKey: activeConfig.vendorKey,
    vendorReference: submitResult.vendorReference,
    livenessUrl: null,
    livenessSessionExpiresAt: null,
  }
}

export async function resolveIdentityVerificationConsentVendor(
  verificationId: string,
  client = db,
): Promise<IdentityVerificationConsentVendor> {
  const snapshot = await loadAutomationSnapshot(verificationId, client)
  return resolveIdentityVerificationConsentVendorForSubject({
    providerId: snapshot.providerId,
    providerApplicationId: snapshot.providerApplicationId,
  }, client)
}

export async function resolveIdentityVerificationConsentVendorForSubject(
  subject: { providerId?: string | null; providerApplicationId?: string | null },
  client = db,
): Promise<IdentityVerificationConsentVendor> {
  const activeConfig = await resolveActiveVendorConfig({
    providerId: subject.providerId ?? null,
    providerApplicationId: subject.providerApplicationId ?? null,
  }, client)
  return {
    vendorKey: activeConfig.vendorKey,
    vendorDisplayName: await resolveVendorDisplayName(activeConfig.vendorKey, client),
  }
}

// Accept both the singleton PrismaClient and any transaction client (the
// `$transaction` callback parameter or crudAction's TxClient).  Prisma's
// `TransactionClient` is `Omit<PrismaClient, '$connect'|'$disconnect'|'$on'
// |'$transaction'|'$use'|'$extends'>` - structurally a superset for everything
// applyVendorVerdict uses (findUniqueOrThrow + create + update on the relevant
// models), so a single union covers both callers cleanly.
export type ApplyVendorVerdictClient = Prisma.TransactionClient | typeof db

export async function applyVendorVerdict(
  verificationId: string,
  result: NormalizedVerificationResult,
  source: 'sync' | 'webhook',
  client: ApplyVendorVerdictClient = db,
): Promise<SubmitVerificationForAutomationResult> {
  const verification = await client.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    select: {
      id: true,
      status: true,
      providerId: true,
      sourceCheckProvider: true,
      vendorReference: true,
      livenessSessionExpiresAt: true,
    },
  })

  if (['PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(verification.status)) {
    await client.providerVerificationEvent.create({
      data: {
        verificationId,
        fromStatus: verification.status,
        toStatus: verification.status,
        reasonCode: 'VENDOR_VERDICT_RECEIVED_AFTER_TERMINAL',
        metadata: { source, decision: result.decision, vendorReference: result.vendorReference },
      },
    })
    return automationResultFromSnapshot(verification, verification.sourceCheckProvider ?? 'manual')
  }

  const config = await resolveVendorConfigForVerdict(verification.sourceCheckProvider, client)
  const scoreData = {
    documentConfidenceScore: result.documentConfidence,
    livenessScore: result.livenessScore,
    selfieMatchScore: result.selfieMatchScore,
    riskFlags: result.riskFlags as Prisma.InputJsonValue,
    rawPayloadRedacted: {
      source,
      decision: result.decision,
      reasonCode: result.reasonCode,
      confidence: result.confidence,
    } as Prisma.InputJsonValue,
    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
  }

  if (
    config.vendorKey !== 'manual' &&
    await isEnabled('provider.identity.verification.freeze_vendor_verdicts', { userId: verification.providerId ?? undefined })
  ) {
    return transitionToManualReview(verificationId, 'VENDOR_VERDICT_FROZEN', scoreData, client)
  }

  if (config.livenessRequired && result.decision === 'PASS' && result.livenessVerified !== true) {
    return transitionToManualReview(
      verificationId,
      result.livenessVerified === false ? 'PROVIDER_LIVENESS_FAILED' : 'PROVIDER_LIVENESS_RESULT_MISSING',
      scoreData,
      client,
    )
  }

  if (result.decision === 'PASS' && (result.confidence ?? 0) >= config.confidenceThreshold) {
    const assuranceLevel: VerificationAssuranceLevel = result.assuranceLevelHint ?? 'HIGH'
    await transitionIdentityVerification({
      verificationId,
      toStatus: 'PASSED',
      decision: 'PASS',
      reasonCode: result.reasonCode ?? undefined,
      metadata: { source, vendorReference: result.vendorReference, assuranceLevel },
      data: { ...scoreData, assuranceLevel },
    }, client)
    return {
      verificationId,
      status: 'PASSED',
      vendorKey: config.vendorKey,
      vendorReference: verification.vendorReference,
      livenessUrl: null,
      livenessSessionExpiresAt: verification.livenessSessionExpiresAt,
    }
  }

  const reasonCode =
    result.decision === 'PASS'
      ? 'PROVIDER_LOW_CONFIDENCE'
      : result.reasonCode ??
        (result.decision === 'FAIL'
          ? 'PROVIDER_FAIL'
          : result.decision === 'INCONCLUSIVE'
            ? 'PROVIDER_INCONCLUSIVE'
            : result.decision === 'PROVIDER_UNAVAILABLE'
              ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_REQUESTED_MANUAL_REVIEW')

  return transitionToManualReview(verificationId, reasonCode, scoreData, client)
}

export async function transitionIdentityVerification(
  input: TransitionIdentityVerificationInput,
  client: IdentityVerificationClient = db,
) {
  const current = await client.providerIdentityVerification.findUnique({
    where: { id: input.verificationId },
    select: { id: true, providerId: true, status: true, decision: true },
  })

  if (!current) {
    throw new IdentityVerificationTransitionError(
      'NOT_FOUND',
      `Identity verification ${input.verificationId} was not found.`,
    )
  }

  if (!ALLOWED_TRANSITIONS[current.status].includes(input.toStatus)) {
    throw new IdentityVerificationTransitionError(
      'INVALID_TRANSITION',
      `Cannot move identity verification ${input.verificationId} from ${current.status} to ${input.toStatus}.`,
    )
  }

  const updated = await client.providerIdentityVerification.update({
    where: { id: input.verificationId },
    data: {
      ...(input.data ?? {}),
      status: input.toStatus,
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.reasonCode ? { failureReasonCode: input.reasonCode } : {}),
    },
  })

  await client.providerVerificationEvent.create({
    data: {
      verificationId: input.verificationId,
      fromStatus: current.status,
      toStatus: input.toStatus,
      actorId: input.actorId,
      actorRole: input.actorRole,
      decision: input.decision,
      reasonCode: input.reasonCode,
      metadata: toJson(input.metadata),
    },
  })

  if (current.providerId) {
    const kycStatus = kycStatusForTransition(input.toStatus, input.decision)
    if (kycStatus) {
      await client.provider.update({
        where: { id: current.providerId },
        data: { kycStatus },
      })
    }
  }

  if (
    current.status !== input.toStatus &&
    TERMINAL_NOTIFICATION_STATUSES.has(input.toStatus) &&
    !isHarmlessTerminalTransition(current.status, input.toStatus)
  ) {
    void notifyTerminalVerificationStatus(input.verificationId, input.toStatus)
  }

  return updated
}

// PASSED → EXPIRED is a Didit session cleanup artefact: the provider has
// already received the PASSED success confirmation and the cleanup cron is
// only retiring the (now stale) verification session row. Re-notifying with
// "your session expired before you finished" on top of a successful PASSED is
// confusing copy and erodes trust. Suppress the follow-up notification for
// this specific transition only; every other path into EXPIRED (STARTED,
// AWAITING_*, RETRY_REQUIRED) still notifies.
function isHarmlessTerminalTransition(
  fromStatus: VerificationStatus,
  toStatus: VerificationStatus,
): boolean {
  return fromStatus === 'PASSED' && toStatus === 'EXPIRED'
}

const TERMINAL_NOTIFICATION_STATUSES = new Set<VerificationStatus>([
  'PASSED',
  'NEEDS_MANUAL_REVIEW',
  'FAILED',
  // EXPIRED + CANCELLED added so providers whose Didit session lapses
  // (timeout) or is admin-cancelled get a follow-up message instead of
  // silently falling off the funnel. WhatsApp delivery is still bounded by
  // the 24h re-engagement window because this path uses sendText (free-text)
  // rather than a Meta-approved template — same constraint as the existing
  // PASSED/NEEDS_MANUAL_REVIEW/FAILED notifications.
  'EXPIRED',
  'CANCELLED',
])

function terminalNotificationText(status: VerificationStatus): string | null {
  if (status === 'PASSED') {
    return 'Your identity verification is complete. Your profile has been updated.'
  }
  if (status === 'NEEDS_MANUAL_REVIEW') {
    return "Thanks. Your details are with our review team - usually within 30 minutes during business hours; otherwise next working day."
  }
  if (status === 'FAILED') {
    return 'We could not approve your identity verification. Please contact Plug A Pro support so we can help with next steps.'
  }
  if (status === 'EXPIRED') {
    // No fault, just timed out. The kyc-drive cron will re-engage with a
    // signed link in due course; we don't include one here because sendText
    // is free-text (no URL button) and an unsigned link would dead-end at
    // sign-in.
    return 'Your identity verification session expired before you finished. Reply VERIFY to start again, or wait for us to send you a new link.'
  }
  if (status === 'CANCELLED') {
    // Usually admin-initiated (NEEDS_MANUAL_REVIEW → CANCELLED) or
    // auto-cleanup. Telling the provider it was "cancelled" without context
    // would alarm them; direct to support so ops can explain or restart.
    return 'Your identity verification has been cancelled. Please contact Plug A Pro support if this was unexpected and we can help you continue.'
  }
  return null
}

export async function notifyTerminalVerificationStatus(
  verificationId: string,
  toStatus: VerificationStatus,
): Promise<void> {
  try {
    const text = terminalNotificationText(toStatus)
    if (!text) return
    const verification = await db.providerIdentityVerification.findUnique({
      where: { id: verificationId },
      select: { provider: { select: { phone: true } } },
    })
    const phone = verification?.provider?.phone
    if (!phone) {
      logIdentityVerificationEvent('verify.terminal_notify.skip_no_phone', {
        verificationId,
        toStatus,
      })
      return
    }
    await sendText(phone, text)
    logIdentityVerificationEvent('verify.terminal_notify.sent', {
      verificationId,
      toStatus,
    })
  } catch (error) {
    logIdentityVerificationError('verify.terminal_notify.failed', error, {
      verificationId,
      toStatus,
    })
  }
}

function kycStatusForTransition(
  status: VerificationStatus,
  decision?: VerificationDecision,
): KycStatus | null {
  if (status === 'PASSED' && decision === 'PASS') return 'VERIFIED'
  if (status === 'FAILED') return 'REJECTED'
  if (status === 'EXPIRED') return 'EXPIRED'
  return null
}

async function transitionToManualReview(
  verificationId: string,
  reasonCode: string,
  data: Prisma.ProviderIdentityVerificationUpdateInput,
  client: ApplyVendorVerdictClient = db,
): Promise<SubmitVerificationForAutomationResult> {
  await transitionIdentityVerification({
    verificationId,
    toStatus: 'NEEDS_MANUAL_REVIEW',
    decision: 'MANUAL_REVIEW',
    reasonCode,
    metadata: { reasonCode },
    data: { ...data, assuranceLevel: 'MEDIUM' },
  }, client)
  const current = await client.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    select: { id: true, status: true, sourceCheckProvider: true, vendorReference: true, livenessSessionExpiresAt: true },
  })
  return automationResultFromSnapshot(current, current.sourceCheckProvider ?? 'manual')
}

async function loadAutomationSnapshot(verificationId: string, client = db) {
  return client.providerIdentityVerification.findUniqueOrThrow({
    where: { id: verificationId },
    include: {
      documents: {
        where: { deletedAt: null },
        select: { id: true, documentKind: true, blobKey: true, mimeType: true, sha256: true },
      },
    },
  })
}

async function resolveActiveVendorConfig(
  snapshot: { providerId?: string | null; providerApplicationId?: string | null },
  client = db,
) {
  const automationEnabled = await isEnabled('provider.identity.verification.automation', { userId: snapshot.providerId ?? undefined })
  if (!automationEnabled) return manualConfig()

  // Pilot gate: when ON (default), only allowlisted providers get the active
  // vendor; when OFF (GA), the allowlist check is skipped and every provider
  // matching the automation + vendor gates routes through.
  const pilotGateRequired = await isEnabled(
    'provider.identity.verification.pilot_allowlist_required',
    { userId: snapshot.providerId ?? undefined },
  )
  if (pilotGateRequired) {
    const allowlisted = await client.providerIdentityVerificationPilotAllowlist.findFirst({
      where: {
        OR: [
          snapshot.providerId ? { providerId: snapshot.providerId } : undefined,
          snapshot.providerApplicationId ? { providerApplicationId: snapshot.providerApplicationId } : undefined,
        ].filter(Boolean) as Prisma.ProviderIdentityVerificationPilotAllowlistWhereInput[],
      },
      select: { id: true },
    })
    if (!allowlisted) return manualConfig()
  }

  const active = await client.verificationVendorConfig.findMany({
    where: { active: true },
    take: 2,
  })
  if (active.length !== 1) return manualConfig()

  const vendorKey = toVendorKey(active[0].vendorKey)
  if (!vendorKey || vendorKey === 'manual') return manualConfig()
  const flagKey = vendorFlagKey(vendorKey)
  const vendorEnabled = flagKey ? await isEnabled(flagKey, { userId: snapshot.providerId ?? undefined }) : true
  if (!vendorEnabled) return manualConfig()

  return {
    vendorKey,
    confidenceThreshold: active[0].confidenceThreshold,
    livenessRequired: active[0].livenessRequired,
  }
}

function manualConfig() {
  return {
    vendorKey: 'manual' as const,
    confidenceThreshold: 0.9,
    livenessRequired: false,
  }
}

async function resolveVendorConfigForVerdict(sourceCheckProvider: string | null, client: ApplyVendorVerdictClient = db) {
  const vendorKey = toVendorKey(sourceCheckProvider) ?? 'manual'
  if (vendorKey === 'manual') return manualConfig()
  const row = await client.verificationVendorConfig.findUnique({ where: { vendorKey } })
  return row
    ? { vendorKey, confidenceThreshold: row.confidenceThreshold, livenessRequired: row.livenessRequired }
    : manualConfig()
}

async function resolveVendorDisplayName(vendorKey: VendorKey, client = db) {
  if (vendorKey === 'manual') return 'Plug A Pro review team'
  const row = await client.verificationVendorConfig.findUnique({
    where: { vendorKey },
    select: { configJson: true },
  })
  const displayName = readDisplayName(row?.configJson)
  if (displayName) return displayName
  if (vendorKey === 'smile_id') return 'Smile ID'
  if (vendorKey === 'didit') return 'Didit'
  if (vendorKey === 'thisisme') return 'ThisIsMe'
  if (vendorKey === 'datanamix') return 'Datanamix'
  if (vendorKey === 'omnicheck') return 'OmniCheck'
  return 'Mock identity provider'
}

function readDisplayName(configJson: unknown): string | null {
  if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) return null
  const displayName = (configJson as { displayName?: unknown }).displayName
  return typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null
}

function hasConsentForVendor(
  snapshot: { consentVendorKey?: string | null },
  vendorKey: VendorKey,
) {
  if (vendorKey === 'manual') return true
  return snapshot.consentVendorKey === vendorKey
}

function shouldRefreshExpiredLiveness(snapshot: {
  status: VerificationStatus
  livenessSessionExpiresAt?: Date | null
}) {
  return snapshot.status === 'AWAITING_LIVENESS' &&
    Boolean(snapshot.livenessSessionExpiresAt) &&
    snapshot.livenessSessionExpiresAt! <= new Date()
}

async function revealIdentifierForSubmission(snapshot: Awaited<ReturnType<typeof loadAutomationSnapshot>>, client = db) {
  if (!snapshot.identifierEncrypted) return null
  await client.providerSensitiveDataAccessLog.create({
    data: {
      verificationId: snapshot.id,
      actorId: 'system:identity-automation',
      actorRole: 'system',
      accessType: 'REVEAL_IDENTIFIER',
    },
  })
  return decryptIdentifier(snapshot.identifierEncrypted)
}

function buildSubmitDocumentInput(
  snapshot: Awaited<ReturnType<typeof loadAutomationSnapshot>>,
  vendorKey: VendorKey,
  identifierPlaintext: string | null,
  token: string,
): SubmitDocumentCheckInput {
  const base = getPublicAppUrl('') || ''
  return {
    verificationId: snapshot.id,
    providerId: snapshot.providerId,
    identityBasis: snapshot.identityBasis,
    issuingCountry: snapshot.issuingCountry,
    identifierHash: snapshot.identifierHash,
    identifierLast4: snapshot.identifierLast4,
    identifierPlaintext,
    documents: snapshot.documents.map((document) => ({
      id: document.id,
      kind: document.documentKind,
      blobKey: document.blobKey,
      mimeType: document.mimeType,
      sha256: document.sha256,
    })),
    webhookCallbackUrl: `${base}/api/webhooks/verification/${vendorKey}`,
    livenessReturnUrl: `${base}/provider/verify/${encodeURIComponent(token)}/liveness/complete`,
  }
}

function automationResultFromSnapshot(
  snapshot: { id: string; status: VerificationStatus; sourceCheckProvider?: string | null; vendorReference?: string | null; livenessSessionExpiresAt?: Date | null },
  vendorKey: string,
): SubmitVerificationForAutomationResult {
  return {
    verificationId: snapshot.id,
    status: snapshot.status,
    vendorKey: toVendorKey(vendorKey) ?? 'manual',
    vendorReference: snapshot.vendorReference ?? null,
    livenessUrl: null,
    livenessSessionExpiresAt: snapshot.livenessSessionExpiresAt ?? null,
  }
}

function vendorFlagKey(vendorKey: VendorKey) {
  if (vendorKey === 'manual' || vendorKey === 'mock') return null
  return `provider.identity.vendor.${vendorKey}` as const
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
