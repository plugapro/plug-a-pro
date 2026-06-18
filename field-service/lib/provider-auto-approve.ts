// Phase 1 auto-approval - approves PENDING provider applications that have all
// required fields (name, skills, service areas and experience).
// HIGH_RISK_CATEGORY applications (Electrical, Roofing, Pest Control and Air
// Conditioning) are routed to manual review and are not auto-approved. Plumbing is
// standard and must not block auto-approval.
//
// This rewrite makes auto-approval itself a bounded transactional operation and
// moves optional side-effects into replayable markers.

import { type Prisma as PrismaTypes } from '@prisma/client'
import { db } from './db'
import { isEnabled } from './flags'
import { assessProviderApplicationForOpsReview } from './provider-application-review-support'
import { syncProviderRecord } from './provider-record'
import { awardPromoCreditsForMilestone } from './provider-promo-awards'
import { OPS_QUEUE_TYPES, releaseOpsQueueItem } from './ops-queue'
import { notifyProviderApplicationApprovedOnce } from './provider-application-notifications'
import { checkJobsForNewProviderAvailability } from './matching/customer-recontact'
import { findConflictingActiveProviderApplications } from './provider-applications'
import { resolveServiceCategoryTag } from './service-categories'
import { recordAuditLog } from './audit'
import { isKycRequiredForActivation } from './kyc-policy'
import { KYC_GRACE_FLAG } from './matching/kyc-grace'
import { checkCanBeApproved } from './provider-lead-eligibility'

// Kind-level side-effects that can be retried after the core approval commit.
type SideEffectKind = 'PROMO_AWARD' | 'NOTIFICATION' | 'MATCH_RECHECK'
type SideEffectStatus = 'PENDING' | 'DONE' | 'FAILED'

// Minimal marker shape used by replay logic. Keep this separate from Prisma input
// types because some environments may still run with older generated clients.
type SideEffectMarkerRecord = {
  id: string
  kind: SideEffectKind
  applicationId: string
  providerId: string
  status: SideEffectStatus
  reason: string | null
  retryCount: number
  lastError: string | null
  runId: string | null
  nextRetryAt: Date | null
  attemptedAt: Date | null
  sourceRefType: string
  sourceRefId: string
}

type SideEffectMarkerClient = {
  findMany?: (args: any) => Promise<SideEffectMarkerRecord[]>
  findUnique?: (args: any) => Promise<SideEffectMarkerRecord | null>
  upsert?: (args: any) => Promise<SideEffectMarkerRecord>
  update?: (args: any) => Promise<SideEffectMarkerRecord>
}

type ProviderApplicationRow = {
  id: string
  phone: string
  name: string
  status?: 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  skills: string[]
  serviceAreas: string[]
  experience: string | null
  notes: string | null
  providerId: string | null
  isTestUser: boolean
  cohortName: string | null
}

type AutoApproveDb = {
  providerApplication: {
    findMany: (args: any) => Promise<ProviderApplicationRow[]>
    findUnique?: (args: any) => Promise<ProviderApplicationLookup | null>
    updateMany: (args: any) => Promise<{ count: number }>
  }
  // Optional — used by the KYC pre-flight to read the linked provider's KYC
  // snapshot (kycStatus, createdAt, kycGraceUntil, kycOverriddenAt). Test
  // doubles may omit this; when missing, the pre-flight assumes NOT_STARTED
  // and the gate denies (correct fail-closed behavior under mandatory KYC).
  provider?: {
    findUnique?: (args: any) => Promise<{
      kycStatus?: string | null
      createdAt?: Date | null
      kycGraceUntil?: Date | null
      kycOverriddenAt?: Date | null
    } | null>
  }
  providerAutoApproveSideEffectMarker?: SideEffectMarkerClient
  providerPromoAward?: {
    count: (args?: any) => Promise<number>
  }
  paymentIntent?: {
    count: (args?: any) => Promise<number>
  }
  providerCategory?: {
    createMany: (args: any) => Promise<{ count: number }>
    updateMany: (args: any) => Promise<{ count: number }>
  }
  $transaction: (callbackOrOps: any, options?: any) => Promise<unknown>
}

type ProviderApplicationLookup = {
  id: string
  status: 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  phone: string
  name: string
}

type SideEffectActionResult = {
  status: 'done' | 'skipped' | 'failed'
  reason: string
  attempted: boolean
  awarded?: boolean
}

export type AutoApproveReconciliationItem = {
  kind: SideEffectKind
  applicationId: string
  providerId: string
  attemptedAt: Date
  reason: string
  retryCount: number
  lastError: string | null
}

export type AutoApproveResult = {
  attempted: number
  approved: number
  skipped: number
  errors: number
  txAborts: number
  reconciliation: {
    scanned: number
    replayed: number
    skipped: number
    hardFailed: number
  }
  sideEffectSummary: {
    promoAwarded: number
    promoFailed: number
    notifyQueued: number
    queueReleased: number
    enrichmentQueued: number
  }
  skippedReasons: string[]
}

type AutoApproveParams = {
  limit?: number
  runId?: string
  reconciliationLimit?: number
}

type PreflightResult = {
  isCompatible: boolean
  reasons: string[]
}

const ACTOR_ID = 'system:auto-approve'
const AUTO_APPROVE_LIMIT_DEFAULT = 50
const AUTO_APPROVE_SOURCE_TYPE = 'provider_application'
const AUTO_APPROVE_SIDE_EFFECT_MAX_RETRIES = 5
const AUTO_APPROVE_SIDE_EFFECT_RETRY_MINUTES = [5, 15, 30, 60, 180]
const AUTO_APPROVE_TRANSACTION_TIMEOUT_MS = 15000
const AUTO_APPROVE_SIDE_EFFECT_KINDS = ['PROMO_AWARD', 'NOTIFICATION', 'MATCH_RECHECK'] as const
const AUTO_APPROVE_SIDE_EFFECT_STATUSES = ['PENDING', 'DONE', 'FAILED'] as const
const AUTO_APPROVE_SIDE_EFFECT_MARKER_REQUIRED_COLUMNS = [
  'id',
  'kind',
  'applicationId',
  'providerId',
  'sourceRefType',
  'sourceRefId',
  'status',
  'reason',
  'retryCount',
  'lastError',
  'runId',
  'attemptedAt',
  'nextRetryAt',
  'createdAt',
  'updatedAt',
] as const

function isSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  // 42P01: undefined table, 42703: undefined column, 42704: undefined type
  if (code === '42P01' || code === '42703' || code === '42704') return true

  const message = toErrorText(error).toLowerCase()
  return (
    message.includes('does not exist') ||
    message.includes('relation') ||
    message.includes('unknown argument')
  )
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isTransactionAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  return code === '25P02'
}

function buildSkippedReasonSet(values: string[]) {
  return [...new Set(values)]
}

function nextRetryAt(retryCount: number) {
  if (retryCount >= AUTO_APPROVE_SIDE_EFFECT_MAX_RETRIES) return null
  const delayMinutes = AUTO_APPROVE_SIDE_EFFECT_RETRY_MINUTES[
    Math.min(retryCount, AUTO_APPROVE_SIDE_EFFECT_RETRY_MINUTES.length - 1)
  ]
  const nextDate = new Date()
  nextDate.setMinutes(nextDate.getMinutes() + delayMinutes)
  return nextDate
}

function markerWhere(kind: SideEffectKind, applicationId: string) {
  return { kind_applicationId: { kind, applicationId } } as const
}

function markerRunResult(
  rows: SideEffectMarkerRecord[],
): AutoApproveReconciliationItem[] {
  return rows.map((row) => ({
    kind: row.kind,
    applicationId: row.applicationId,
    providerId: row.providerId,
    attemptedAt: row.attemptedAt ?? new Date(),
    reason: row.reason ?? 'pending',
    retryCount: row.retryCount,
    lastError: row.lastError,
  }))
}

async function checkProviderPromoAwardSchemaCompatibility(client: AutoApproveDb): Promise<PreflightResult> {
  if (!client.providerPromoAward?.count) {
    return { isCompatible: false, reasons: ['PROMO_AWARD_MODEL_MISSING'] }
  }
  try {
    await client.providerPromoAward.count({})
    return { isCompatible: true, reasons: [] }
  } catch (error) {
    return { isCompatible: false, reasons: [`PROMO_AWARD_SCHEMA_PRECHECK_FAILED:${toErrorText(error)}`] }
  }
}

async function checkPaymentIntentSchemaCompatibility(client: AutoApproveDb): Promise<PreflightResult> {
  if (!client.paymentIntent?.count) {
    return { isCompatible: false, reasons: ['PAYMENT_INTENT_MODEL_MISSING'] }
  }
  try {
    // Probe the exact field that the promo award queries - catches column drift early.
    await client.paymentIntent.count({ where: { providerId: '__precheck__' } })
    return { isCompatible: true, reasons: [] }
  } catch (error) {
    if (isSchemaError(error)) {
      return { isCompatible: false, reasons: ['PAYMENT_INTENT_SCHEMA_DRIFT'] }
    }
    return { isCompatible: false, reasons: [`PAYMENT_INTENT_SCHEMA_PRECHECK_FAILED:${toErrorText(error)}`] }
  }
}

async function checkProviderAutoApproveSideEffectSchemaCompatibility(client: AutoApproveDb): Promise<PreflightResult> {
  if (!client.providerAutoApproveSideEffectMarker?.findMany) {
    return { isCompatible: false, reasons: ['SIDE_EFFECT_MODEL_MISSING'] }
  }
  try {
    await client.providerAutoApproveSideEffectMarker.findMany({ where: { id: '__precheck__' }, take: 0 })
    return { isCompatible: true, reasons: [] }
  } catch (error) {
    if (isSchemaError(error)) {
      return { isCompatible: false, reasons: ['SIDE_EFFECT_SCHEMA_MISSING_OR_INCOMPATIBLE'] }
    }
    return { isCompatible: false, reasons: [`SIDE_EFFECT_SCHEMA_PRECHECK_FAILED:${toErrorText(error)}`] }
  }
}

async function upsertSideEffectMarker(
  client: AutoApproveDb,
  marker: {
    kind: SideEffectKind
    applicationId: string
    providerId: string
    sourceRefType: string
    sourceRefId: string
    runId: string
  },
) {
  const storage = client.providerAutoApproveSideEffectMarker
  if (!storage?.upsert) return null

  return storage.upsert({
    where: markerWhere(marker.kind, marker.applicationId),
    create: {
      kind: marker.kind,
      applicationId: marker.applicationId,
      providerId: marker.providerId,
      sourceRefType: marker.sourceRefType,
      sourceRefId: marker.sourceRefId,
      status: 'PENDING',
      reason: 'SCHEDULED',
      retryCount: 0,
      lastError: null,
      runId: marker.runId,
      nextRetryAt: null,
      attemptedAt: null,
    },
    update: {
      kind: marker.kind,
      status: 'PENDING',
      reason: 'SCHEDULED',
      providerId: marker.providerId,
      lastError: null,
      runId: marker.runId,
      nextRetryAt: null,
      sourceRefType: marker.sourceRefType,
      sourceRefId: marker.sourceRefId,
    },
  })
}

async function updateSideEffectMarker(client: AutoApproveDb, kind: SideEffectKind, applicationId: string, data: {
  status: SideEffectStatus
  reason: string
  runId: string
  retryCount?: number
  lastError?: string | null
  attemptedAt: Date
  nextRetryAt?: Date | null
}) {
  const storage = client.providerAutoApproveSideEffectMarker
  if (!storage?.update) return null

  return storage.update({
    where: markerWhere(kind, applicationId),
    data,
  })
}

async function executeSideEffectAction(params: {
  client: AutoApproveDb
  kind: SideEffectKind
  applicationId: string
  providerId: string
  sourceRefType: string
  sourceRefId: string
}) {
  if (params.kind === 'PROMO_AWARD') {
    // VOUCHER_PILOT: Auto-award disabled. Provider credits are now granted exclusively
    // via single-use voucher redemption (WhatsApp "redeem" or PWA /provider/voucher).
    // Returning 'done' prevents infinite retries while preserving the marker audit trail.
    return {
      status: 'done' as const,
      reason: 'PROMO_AWARD_DISABLED_VOUCHER_PILOT',
      awarded: false,
      attempted: false,
    }
  }

  if (params.kind === 'NOTIFICATION') {
    const app = await params.client.providerApplication.findUnique?.({
      where: { id: params.applicationId },
      select: { status: true, phone: true, name: true },
    })
    if (!app) {
      return { status: 'skipped' as const, reason: 'NOTIFICATION_SKIPPED_APPLICATION_NOT_FOUND', attempted: false }
    }
    if (app.status !== 'APPROVED') {
      return {
        status: 'skipped' as const,
        reason: `NOTIFICATION_SKIPPED_${app.status}`,
        attempted: false,
      }
    }

    const result = await notifyProviderApplicationApprovedOnce({
      applicationId: params.applicationId,
      phone: app.phone,
      name: app.name,
    })

    return {
      status: 'done' as const,
      reason: result.status === 'sent' ? 'NOTIFICATION_SENT' : `NOTIFICATION_${result.reason.toUpperCase()}`,
      awarded: false,
      attempted: true,
    }
  }

  const matchResult = await checkJobsForNewProviderAvailability(params.providerId)
  return {
    status: 'done' as const,
    reason: `MATCH_RECHECK_DISPATCHED:${matchResult.dispatchedOpenJobs || 0}`,
    attempted: true,
  }
}

function shouldRetry(retryCount: number, compatible: boolean, markerStatus: SideEffectStatus) {
  if (!compatible) return { run: false, terminal: false, reason: 'SIDE_EFFECT_SCHEMA_CHECK_REQUIRED' }
  if (markerStatus === 'FAILED' && retryCount >= AUTO_APPROVE_SIDE_EFFECT_MAX_RETRIES) {
    return { run: false, terminal: true, reason: 'SIDE_EFFECT_RETRY_LIMIT_REACHED' }
  }
  return { run: true, terminal: false, reason: 'SIDE_EFFECT_RETRY' }
}

async function scheduleAndRunSideEffect(params: {
  client: AutoApproveDb
  kind: SideEffectKind
  applicationId: string
  providerId: string
  runId: string
  sourceRefType: string
  sourceRefId: string
  markerEnabled: boolean
  enabled: boolean
}): Promise<SideEffectActionResult> {
  const storage = params.client.providerAutoApproveSideEffectMarker
  const canUseMarker = params.markerEnabled && Boolean(storage?.upsert && storage?.update)

  const runDirectAction = async (): Promise<SideEffectActionResult> => {
    if (!params.enabled) {
      return { status: 'skipped', reason: 'SIDE_EFFECT_SCHEMA_DISABLED', attempted: false }
    }

    const action = await executeSideEffectAction({
      client: params.client,
      kind: params.kind,
      applicationId: params.applicationId,
      providerId: params.providerId,
      sourceRefType: params.sourceRefType,
      sourceRefId: params.sourceRefId,
    })

    return action
  }

  // Marker-backed path: safe for retries and duplicate prevention.
  if (canUseMarker) {
    let marker: SideEffectMarkerRecord | null = null
    try {
      marker = await upsertSideEffectMarker(params.client, {
        kind: params.kind,
        applicationId: params.applicationId,
        providerId: params.providerId,
        sourceRefType: params.sourceRefType,
        sourceRefId: params.sourceRefId,
        runId: params.runId,
      })

      if (!marker) {
        return { status: 'skipped', reason: 'SIDE_EFFECT_MARKER_UPSERT_FAILED', attempted: false }
      }

      if (marker.status === 'DONE') {
        return { status: 'skipped', reason: 'SIDE_EFFECT_ALREADY_DONE', attempted: false }
      }

      if (marker.status === 'FAILED' && marker.retryCount >= AUTO_APPROVE_SIDE_EFFECT_MAX_RETRIES) {
        return {
          status: 'failed',
          reason: 'SIDE_EFFECT_RETRY_LIMIT_REACHED',
          attempted: false,
        }
      }

      const retryPolicy = shouldRetry(marker.retryCount, params.enabled, marker.status)
      if (!retryPolicy.run) {
        if (marker.status !== 'FAILED') {
          await updateSideEffectMarker(params.client, params.kind, params.applicationId, {
            status: 'PENDING',
            reason: retryPolicy.reason,
            runId: params.runId,
            retryCount: marker.retryCount,
            attemptedAt: new Date(),
            nextRetryAt: marker.nextRetryAt,
            lastError: marker.lastError,
          })
        }

        return {
          status: retryPolicy.terminal ? 'failed' : 'skipped',
          reason: retryPolicy.reason,
          attempted: false,
        }
      }

      const action = await executeSideEffectAction({
        client: params.client,
        kind: params.kind,
        applicationId: params.applicationId,
        providerId: params.providerId,
        sourceRefType: params.sourceRefType,
        sourceRefId: params.sourceRefId,
      })

      await updateSideEffectMarker(params.client, params.kind, params.applicationId, {
        status: 'DONE',
        reason: action.reason,
        runId: params.runId,
        retryCount: marker.retryCount + 1,
        attemptedAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      })

      return action
    } catch (error) {
      if (marker) {
        const nextCount = marker.retryCount + 1
        const retryAt = nextRetryAt(marker.retryCount)
        if (!retryAt || nextCount >= AUTO_APPROVE_SIDE_EFFECT_MAX_RETRIES) {
          await updateSideEffectMarker(params.client, params.kind, params.applicationId, {
            status: 'FAILED',
            reason: 'SIDE_EFFECT_RETRY_LIMIT_REACHED',
            runId: params.runId,
            retryCount: nextCount,
            attemptedAt: new Date(),
            nextRetryAt: null,
            lastError: toErrorText(error),
          })
        } else {
          await updateSideEffectMarker(params.client, params.kind, params.applicationId, {
            status: 'PENDING',
            reason: 'SIDE_EFFECT_RETRY',
            runId: params.runId,
            retryCount: nextCount,
            attemptedAt: new Date(),
            nextRetryAt: retryAt,
            lastError: toErrorText(error),
          })
        }
      }

      console.error('[auto-approve] marker-backed side effect failed, fallback to direct execution', {
        applicationId: params.applicationId,
        kind: params.kind,
        error: toErrorText(error),
      })

      if (!params.enabled && params.kind === 'PROMO_AWARD') {
        return { status: 'skipped', reason: 'SIDE_EFFECT_MARKER_FALLBACK_DISABLED', attempted: false }
      }
    }
  }

  // Marker-backed path unavailable or has failed; run direct action when safe.
  if (!params.enabled && params.kind === 'PROMO_AWARD') {
    return { status: 'skipped', reason: 'SIDE_EFFECT_SCHEMA_DISABLED', attempted: false }
  }

  try {
    return await runDirectAction()
  } catch (error) {
    return {
      status: 'failed',
      reason: `SIDE_EFFECT_FALLBACK_${toErrorText(error)}`,
      attempted: true,
    }
  }
}

async function reconcilePendingSideEffects(client: AutoApproveDb, runId: string, limit?: number) {
  const storage = client.providerAutoApproveSideEffectMarker
  const result = {
    scanned: 0,
    replayed: 0,
    skipped: 0,
    hardFailed: 0,
  }
  if (!storage?.findMany) return result

  const now = new Date()
  const rows = await storage.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { attemptedAt: 'asc' },
    take: limit ?? 50,
  }) as SideEffectMarkerRecord[]

  for (const marker of rows) {
    result.scanned += 1

    if (marker.status === 'FAILED' && marker.retryCount >= AUTO_APPROVE_SIDE_EFFECT_MAX_RETRIES) {
      await updateSideEffectMarker(client, marker.kind, marker.applicationId, {
        status: 'FAILED',
        reason: 'SIDE_EFFECT_RETRY_LIMIT_REACHED',
        runId,
        retryCount: marker.retryCount,
        attemptedAt: new Date(),
        nextRetryAt: null,
        lastError: marker.lastError,
      })
      result.hardFailed += 1
      continue
    }

    try {
      const action = await executeSideEffectAction({
        client,
        kind: marker.kind,
        applicationId: marker.applicationId,
        providerId: marker.providerId,
        sourceRefType: marker.sourceRefType,
        sourceRefId: marker.sourceRefId,
      })

      if (action.status === 'skipped') {
        await updateSideEffectMarker(client, marker.kind, marker.applicationId, {
          status: 'DONE',
          reason: action.reason,
          runId,
          retryCount: marker.retryCount,
          attemptedAt: new Date(),
          nextRetryAt: null,
          lastError: null,
        })
        result.skipped += 1
        continue
      }

      await updateSideEffectMarker(client, marker.kind, marker.applicationId, {
        status: 'DONE',
        reason: action.reason,
        runId,
        retryCount: marker.retryCount + 1,
        attemptedAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      })
      result.replayed += 1
    } catch (error) {
      const retryCount = marker.retryCount + 1
      const retryAt = nextRetryAt(marker.retryCount)

      if (!retryAt) {
        await updateSideEffectMarker(client, marker.kind, marker.applicationId, {
          status: 'FAILED',
          reason: 'SIDE_EFFECT_RETRY_LIMIT_REACHED',
          runId,
          retryCount,
          attemptedAt: new Date(),
          nextRetryAt: null,
          lastError: toErrorText(error),
        })
        result.hardFailed += 1
        continue
      }

      await updateSideEffectMarker(client, marker.kind, marker.applicationId, {
        status: 'PENDING',
        reason: 'SIDE_EFFECT_RETRY',
        runId,
        retryCount,
        attemptedAt: new Date(),
        nextRetryAt: retryAt,
        lastError: toErrorText(error),
      })
      result.skipped += 1
    }
  }

  return result
}

export async function reconcileAutoApproveSideEffects(
  client: AutoApproveDb = db,
  params: { limit?: number; runId?: string } = {},
): Promise<{ scanned: number; replayed: number; skipped: number; hardFailed: number }> {
  return reconcilePendingSideEffects(client, params.runId ?? Math.random().toString(36).slice(2), params.limit)
}

function emptyAutoApproveResult(skippedReason: string): AutoApproveResult {
  return {
    attempted: 0,
    approved: 0,
    skipped: 0,
    errors: 0,
    txAborts: 0,
    reconciliation: { scanned: 0, replayed: 0, skipped: 0, hardFailed: 0 },
    sideEffectSummary: {
      promoAwarded: 0,
      promoFailed: 0,
      notifyQueued: 0,
      queueReleased: 0,
      enrichmentQueued: 0,
    },
    skippedReasons: [skippedReason],
  }
}

export async function autoApproveProviderApplications(
  client: AutoApproveDb = db,
  params: AutoApproveParams = {},
): Promise<AutoApproveResult> {
  // Defense-in-depth kill switch. Field-completeness checks alone must never promote a
  // provider to active/verified/ACTIVE without an explicit operator opt-in. This guard
  // lives inside the function (not just the cron route) so no caller - tests, future
  // routes, manual scripts - can bypass it. Disabled by default; manual admin approval
  // is a separate path and is unaffected.
  if (!(await isEnabled('provider.auto_approve.enabled'))) {
    console.warn(
      '[auto-approve] skipped: feature flag provider.auto_approve.enabled is disabled; no applications were auto-approved (manual admin review required)',
    )
    return emptyAutoApproveResult('AUTO_APPROVE_FLAG_DISABLED')
  }

  // Read a bounded batch of PENDING applications to keep cron runtime predictable.
  const applications = await client.providerApplication.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      phone: true,
      name: true,
      skills: true,
      serviceAreas: true,
      experience: true,
      notes: true,
      providerId: true,
      isTestUser: true,
      cohortName: true,
    },
    orderBy: { submittedAt: 'asc' },
    take: params.limit ?? AUTO_APPROVE_LIMIT_DEFAULT,
  })

  // Check optional side-effect compatibility once per run.
  const promoPreflight = await checkProviderPromoAwardSchemaCompatibility(client)
  const markerPreflight = await checkProviderAutoApproveSideEffectSchemaCompatibility(client)
  const paymentIntentPreflight = await checkPaymentIntentSchemaCompatibility(client)

  if (!promoPreflight.isCompatible) {
    console.error('[auto-approve:promo-schema] preflight failed', { reasons: promoPreflight.reasons })
  }
  if (!markerPreflight.isCompatible) {
    console.error('[auto-approve:marker-schema] preflight failed', { reasons: markerPreflight.reasons })
  }
  if (!paymentIntentPreflight.isCompatible) {
    console.error('[auto-approve:payment-intent-schema] preflight failed - promo awards will be skipped', { reasons: paymentIntentPreflight.reasons })
  }

  const result: AutoApproveResult = {
    attempted: applications.length,
    approved: 0,
    skipped: 0,
    errors: 0,
    txAborts: 0,
    reconciliation: {
      scanned: 0,
      replayed: 0,
      skipped: 0,
      hardFailed: 0,
    },
    sideEffectSummary: {
      promoAwarded: 0,
      promoFailed: 0,
      notifyQueued: 0,
      queueReleased: 0,
      enrichmentQueued: 0,
    },
    skippedReasons: [...promoPreflight.reasons, ...markerPreflight.reasons, ...paymentIntentPreflight.reasons],
  }
  const markerSchemaCompatible = markerPreflight.isCompatible

  const runId = params.runId ?? Math.random().toString(36).slice(2)
  const sideEffectSource = {
    sourceRefType: AUTO_APPROVE_SOURCE_TYPE,
  }

  // Resolve the KYC policy ONCE for the whole batch. Both isKycRequiredForActivation
  // and the grace-flag lookup are tiny (env / cached flag read) but we don't want
  // to pay for them per application in a 100-row batch.
  const kycRequired = await isKycRequiredForActivation()
  const kycGraceEnabled = kycRequired ? await isEnabled(KYC_GRACE_FLAG) : false

  for (const app of applications) {
    // Enforce field completeness and policy guardrails before any writes.
    const assessment = assessProviderApplicationForOpsReview(app)
    const hasMissingFields = assessment.reasonCodes.some((code) => code.startsWith('MISSING_'))
    const hasAutoApprovalBlocker = assessment.reasonCodes.includes('HIGH_RISK_CATEGORY')
    if (hasMissingFields || hasAutoApprovalBlocker) {
      result.skipped += 1
      result.skippedReasons.push(hasMissingFields ? `ASSESSMENT_${assessment.reasonCodes.join('+')}` : 'ASSESSMENT_HIGH_RISK_CATEGORY')
      continue
    }

    // KYC pre-flight. The cron auto-approves whatever the field-completeness
    // check allows, so without this gate a brand-new provider with NOT_STARTED
    // KYC would be auto-promoted to active/verified the moment they submitted
    // their application. When KYC is mandatory, only providers who already
    // have VERIFIED, an admin override, or a live grace window are eligible.
    // Skipped applications stay PENDING for the existing admin worklist.
    if (kycRequired) {
      const linkedProvider =
        app.providerId && client.provider?.findUnique
          ? await client.provider.findUnique({
              where: { id: app.providerId },
              select: {
                kycStatus: true,
                createdAt: true,
                kycGraceUntil: true,
                kycOverriddenAt: true,
              },
            })
          : null
      const gate = checkCanBeApproved(
        {
          kycStatus: linkedProvider?.kycStatus ?? 'NOT_STARTED',
          createdAt: linkedProvider?.createdAt ?? null,
          kycGraceUntil: linkedProvider?.kycGraceUntil ?? null,
          kycOverriddenAt: linkedProvider?.kycOverriddenAt ?? null,
        },
        { kycRequired, kycGraceEnabled },
      )
      if (!gate.ok) {
        result.skipped += 1
        result.skippedReasons.push('NEEDS_KYC')
        continue
      }
    }

    // Avoid duplicates for duplicate active applications on same phone.
    const conflictClient = {
      providerApplication: {
        findFirst: async () => null as { id: string; phone: string; status: string; name?: string | null; providerId?: string | null; submittedAt?: Date } | null,
        findMany: client.providerApplication.findMany,
      },
    } as {
      providerApplication: {
        findFirst: (...args: any[]) => Promise<{ id: string; phone: string; status: string; name?: string | null; providerId?: string | null; submittedAt?: Date } | null>
        findMany: (...args: any[]) => Promise<Array<{ id: string; phone: string; status: string; name?: string | null; providerId?: string | null; submittedAt?: Date }>>
      }
    }

    const conflicts = await findConflictingActiveProviderApplications(conflictClient, app.phone, {
      excludeId: app.id,
    })
    if (conflicts.length > 0) {
      result.skipped += 1
      result.skippedReasons.push('CONFLICT_ACTIVE_APPLICATION')
      continue
    }

    let providerId: string | null = null

    try {
      const phaseAResult = await client.$transaction(async (txClient: unknown) => {
        // Phase A: create/update provider record + approval update + category set
        // + queue release as the only transactionally required path.
        const providerIdFromRecord = await syncProviderRecord(txClient as any, {
          phone: app.phone,
          name: app.name,
          skills: app.skills,
          serviceAreas: app.serviceAreas,
          active: true,
          availableNow: true,
          verified: true,
          isTestUser: app.isTestUser,
          cohortName: app.cohortName,
          skipEnrichment: true,
        })

        const statusUpdate = await (txClient as any).providerApplication.updateMany({
          where: { id: app.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            providerId: providerIdFromRecord,
            reviewedAt: new Date(),
            reviewedById: ACTOR_ID,
          },
        })

        if (statusUpdate.count === 0) {
          // Another worker already approved or changed this row.
          return null
        }

        const categoryRows = app.skills.map((skill) => ({
          providerId: providerIdFromRecord,
          categorySlug: resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
          approvalStatus: 'APPROVED',
        }))

        if (categoryRows.length > 0) {
          await (txClient as any).providerCategory.createMany({
            data: categoryRows,
            skipDuplicates: true,
          })
          await (txClient as any).providerCategory.updateMany({
            where: {
              providerId: providerIdFromRecord,
              categorySlug: { in: categoryRows.map((row) => row.categorySlug) },
            },
            data: { approvalStatus: 'APPROVED' },
          })
        }

        await releaseOpsQueueItem(txClient as any, {
          queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
          entityId: app.id,
        })

        return providerIdFromRecord
      }, { timeout: AUTO_APPROVE_TRANSACTION_TIMEOUT_MS } as never)

      if (!phaseAResult) {
        result.skipped += 1
        result.skippedReasons.push('APPROVAL_ALREADY_PROCESSED')
        continue
      }

      providerId = phaseAResult as string
      result.approved += 1
      result.sideEffectSummary.queueReleased += 1
    } catch (error) {
      result.errors += 1
      if (isTransactionAbort(error)) result.txAborts += 1
      result.skippedReasons.push(isTransactionAbort(error) ? 'TRANSACTION_ABORT' : 'PHASE_A_ERROR')
      console.error('[auto-approve] phase A failed', {
        applicationId: app.id,
        error: toErrorText(error),
      })
      continue
    }

    // Phase B: non-branching side effects are fire-and-forget + retryable.
    syncProviderRecord(client as unknown as any, {
      phone: app.phone,
      name: app.name,
      skills: app.skills,
      serviceAreas: app.serviceAreas,
      active: true,
      availableNow: true,
      verified: true,
      isTestUser: app.isTestUser,
      cohortName: app.cohortName,
    }).catch((error: unknown) => {
      console.error('[auto-approve] enrichment sync failed', {
        applicationId: app.id,
        error,
      })
    })
    result.sideEffectSummary.enrichmentQueued += 1

    if (!providerId) continue

    const sourceRefId = app.id

    const promoResult = await scheduleAndRunSideEffect({
      client,
      kind: 'PROMO_AWARD',
      applicationId: app.id,
      providerId,
      runId,
      markerEnabled: markerSchemaCompatible,
      enabled: promoPreflight.isCompatible && paymentIntentPreflight.isCompatible,
      sourceRefType: sideEffectSource.sourceRefType,
      sourceRefId,
    })

    if (promoResult.status === 'done' && promoResult.awarded) {
      result.sideEffectSummary.promoAwarded += 1
    }
    if (promoResult.status === 'failed') {
      result.sideEffectSummary.promoFailed += 1
      result.skippedReasons.push(`PROMO_AWARD_${promoResult.reason}`)
    }

    const notificationResult = await scheduleAndRunSideEffect({
      client,
      kind: 'NOTIFICATION',
      applicationId: app.id,
      providerId,
      runId,
      markerEnabled: markerSchemaCompatible,
      enabled: true,
      sourceRefType: sideEffectSource.sourceRefType,
      sourceRefId,
    })
    if (notificationResult.status === 'done' || notificationResult.status === 'skipped') {
      result.sideEffectSummary.notifyQueued += 1
    }
    if (notificationResult.status === 'failed') {
      result.skippedReasons.push(`NOTIFICATION_${notificationResult.reason}`)
    }

    const recheckResult = await scheduleAndRunSideEffect({
      client,
      kind: 'MATCH_RECHECK',
      applicationId: app.id,
      providerId,
      runId,
      markerEnabled: markerSchemaCompatible,
      enabled: true,
      sourceRefType: sideEffectSource.sourceRefType,
      sourceRefId,
    })
    if (recheckResult.status === 'failed') {
      result.skippedReasons.push(`MATCH_RECHECK_${recheckResult.reason}`)
    }

    recordAuditLog({
      actorId: ACTOR_ID,
      actorRole: 'system',
      action: 'provider_application.auto_approve',
      entityType: 'ProviderApplication',
      entityId: app.id,
      after: {
        providerId,
        recommendation: assessment.recommendation,
        reasonCodes: assessment.reasonCodes,
      } as PrismaTypes.InputJsonValue,
    }).catch(() => undefined)
  }

  result.reconciliation = await reconcileAutoApproveSideEffects(client, {
    limit: params.reconciliationLimit,
    runId,
  })
  result.skippedReasons = buildSkippedReasonSet(result.skippedReasons)

  return result
}
