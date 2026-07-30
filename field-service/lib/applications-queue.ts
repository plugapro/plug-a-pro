// ─── Unified worklist model for /admin/applications v2 ───────────────────────
// Merges ProviderApplication rows with WhatsApp onboarding recovery rows into
// one priority-ordered worklist. Pure — no DB access, no I/O. All inputs come
// from the page's existing reads (providerApplication.findMany,
// listProviderOnboardingRecoveryRows, listOpsQueueAssignments,
// getConflictingActiveProviderApplicationIds).

import type { ApplicationStatus, KycStatus } from '@prisma/client'
import { normalizePhone } from '@/lib/utils'
import {
  evaluateProviderProfileCompleteness,
  type ProfileCompleteness,
} from '@/lib/provider-onboarding-completeness'
import { PROVIDER_PROFILE_PHOTO_LABEL } from '@/lib/provider-attachment-labels'
import { hasApplicationIdNumber } from '@/lib/pii-id-number'
import {
  providerOnboardingStageLabel,
  safeRefForPhone,
  type ProviderOnboardingRecoveryRow,
} from '@/lib/provider-onboarding-recovery'

// ─── Inputs (subset of what page.tsx already loads) ──────────────────────────

export type ApplicationInput = {
  id: string
  providerId: string | null
  phone: string
  name: string
  skills: string[]
  serviceAreas: string[]
  experience: string | null
  availability: string | null
  callOutFee: { toString(): string } | number | string | null
  idNumber: string | null
  /** SEC-01: last4 survives plaintext retirement; presence checks use both. */
  idNumberLast4?: string | null
  status: ApplicationStatus
  submittedAt: Date
  reviewedAt: Date | null
  notes: string | null
  evidenceNote: string | null
  evidenceFileUrls: string[]
  attachments: Array<{
    id: string
    url: string
    label: string | null
    mimeType: string | null
    safeForPreview: boolean
    uploadedBy: string | null
    createdAt: Date
  }>
  provider: {
    id: string
    verified: boolean
    kycStatus: KycStatus | null
    avatarUrl: string | null
    providerCategories: Array<{
      categorySlug: string
      approvalStatus: string
      updatedAt: Date
    }>
  } | null
  _count: { attachments: number }
}

export type AssignmentInput = {
  claimedById: string | null
  claimedByLabel?: string | null
}

// ─── Output row model ────────────────────────────────────────────────────────

export type QueueBucket =
  | 'ready_to_review'
  | 'stuck_mid_flow'
  | 'more_info'
  | 'idle'
  | 'conflict'
  | 'approved'
  | 'terminal'

export type RowSource = 'whatsapp' | 'pwa' | 'admin' | 'unknown'

export type UnifiedApplicationRow = {
  rowId: string
  phoneKey: string
  phoneTail: string
  phoneMasked: string

  application: ApplicationInput | null
  recovery: ProviderOnboardingRecoveryRow | null

  name: string | null
  primarySkill: string | null
  primaryArea: string | null
  source: RowSource

  completeness: ProfileCompleteness | null
  hasConflict: boolean
  assignment: AssignmentInput | null

  bucket: QueueBucket
  priority: 1 | 2 | 3 | 4 | 5 | 6

  lastActivityAt: Date
  recommendedAction: string
  flags: {
    hasIdNumber: boolean
    hasProfilePhoto: boolean
    attachmentCount: number
    kycStatus: KycStatus | null
    outsideSessionWindow: boolean
    claimedByCurrentUser: boolean
  }
}

// ─── Phone helpers ───────────────────────────────────────────────────────────

export function phoneKeyFor(rawPhone: string): string {
  return normalizePhone(rawPhone)
}

export function phoneTailFor(rawPhone: string): string {
  return phoneKeyFor(rawPhone).replace(/\D/g, '').slice(-4)
}

export function maskPhone(rawPhone: string): string {
  const e164 = phoneKeyFor(rawPhone)
  const digits = e164.replace(/\D/g, '')
  if (digits.length < 4) return '••• ••• ••••'
  const tail = digits.slice(-4)
  if (e164.startsWith('+27')) return `+27 ••• ••• ${tail}`
  const prefixLen = Math.min(digits.length - 4, 3)
  return `+${digits.slice(0, prefixLen)} ••• ••• ${tail}`
}

// ─── Source inference ────────────────────────────────────────────────────────

function inferSource(input: {
  application: ApplicationInput | null
  recovery: ProviderOnboardingRecoveryRow | null
}): RowSource {
  if (input.recovery) {
    if (input.recovery.source === 'inbound' || input.recovery.source === 'conversation') return 'whatsapp'
    if (input.recovery.source === 'application' && !input.application) return 'unknown'
  }
  if (input.application) {
    const adminUploaded = input.application.attachments.some((a) => a.uploadedBy === 'admin')
    if (adminUploaded) return 'admin'
    const hasWaAttachments = input.application.attachments.some(
      (a) => a.uploadedBy === 'whatsapp' || a.uploadedBy === 'inbound',
    )
    if (hasWaAttachments) return 'whatsapp'
    return 'pwa'
  }
  return 'unknown'
}

// ─── Completeness shim ───────────────────────────────────────────────────────

function evaluateApplicationCompleteness(app: ApplicationInput): ProfileCompleteness {
  const profilePhotoAttachmentId =
    app.attachments.find((attachment) => attachment.label === PROVIDER_PROFILE_PHOTO_LABEL)?.id ?? null
  const callOutFee = app.callOutFee == null ? null : Number(app.callOutFee)

  return evaluateProviderProfileCompleteness({
    name: app.name,
    phone: app.phone,
    skills: app.skills,
    serviceAreas: app.serviceAreas,
    experience: app.experience,
    availability: app.availability,
    callOutFee,
    idNumber: app.idNumber,
    idNumberLast4: app.idNumberLast4 ?? null,
    avatarUrl: app.provider?.avatarUrl ?? null,
    profilePhotoAttachmentId,
  })
}

export function completenessScore(completeness: ProfileCompleteness): {
  satisfied: number
  total: number
} {
  // We mirror the FIELD_REQUIREMENTS count without re-exporting it. Tests pin
  // KNOWN_TOTAL to 8 and will fail if the underlying list grows past that.
  const KNOWN_TOTAL = 8
  const total = Math.max(KNOWN_TOTAL, completeness.missing.length)
  return { satisfied: total - completeness.missing.length, total }
}

// ─── Bucket + priority classification ────────────────────────────────────────

function bucketForApplication(input: {
  app: ApplicationInput
  completeness: ProfileCompleteness
  hasConflict: boolean
}): QueueBucket {
  const { app, completeness, hasConflict } = input
  if (hasConflict && app.status === 'PENDING') return 'conflict'
  if (app.status === 'PENDING') {
    return completeness.canApprove ? 'ready_to_review' : 'idle'
  }
  if (app.status === 'MORE_INFO_REQUIRED') return 'more_info'
  if (app.status === 'APPROVED') return 'approved'
  return 'terminal'
}

function bucketForRecoveryOnly(row: ProviderOnboardingRecoveryRow): QueueBucket {
  if (row.stage === 'flow_conflict') return 'conflict'
  if (
    row.stage === 'id_verification_started' ||
    row.stage === 'skills_picker' ||
    row.stage === 'city_picker' ||
    row.stage === 'evidence_upload'
  ) {
    return 'stuck_mid_flow'
  }
  if (row.stage === 'welcome_idle' || row.stage === 'register_started_no_name') return 'idle'
  return 'idle'
}

export function priorityForBucket(bucket: QueueBucket): 1 | 2 | 3 | 4 | 5 | 6 {
  switch (bucket) {
    case 'ready_to_review':
      return 1
    case 'stuck_mid_flow':
      return 2
    case 'more_info':
      return 3
    case 'conflict':
      return 3
    case 'idle':
      return 4
    case 'approved':
      return 5
    case 'terminal':
      return 6
    default: {
      const _exhaustive: never = bucket
      return _exhaustive
    }
  }
}

export const BUCKET_LABEL: Record<QueueBucket, string> = {
  ready_to_review: 'Ready to review',
  stuck_mid_flow: 'Stuck mid-flow',
  more_info: 'More info',
  idle: 'Idle',
  conflict: 'Conflict',
  approved: 'Approved',
  terminal: 'Rejected / Cancelled',
}

export const BUCKET_ORDER: QueueBucket[] = [
  'ready_to_review',
  'stuck_mid_flow',
  'more_info',
  'conflict',
  'idle',
  'approved',
  'terminal',
]

// ─── Recommended action ──────────────────────────────────────────────────────

function recommendedActionFor(input: {
  bucket: QueueBucket
  app: ApplicationInput | null
  completeness: ProfileCompleteness | null
  recovery: ProviderOnboardingRecoveryRow | null
  hasConflict: boolean
}): string {
  if (input.hasConflict) return 'Resolve duplicate active application before approving.'
  switch (input.bucket) {
    case 'ready_to_review':
      return 'Approve or request more info.'
    case 'stuck_mid_flow':
      return input.recovery?.recommendedAction ?? 'Send recovery nudge.'
    case 'more_info':
      return 'Awaiting provider response — reply or close out if stale.'
    case 'idle':
      if (input.recovery) return input.recovery.recommendedAction
      if (input.completeness && !input.completeness.canApprove) {
        const blocking = input.completeness.missing
          .filter((m) => m.severity === 'block_submit' || m.severity === 'block_approve')
          .map((m) => m.field)
        if (blocking.length) return `Missing required fields: ${blocking.join(', ')}.`
      }
      return 'Send recovery nudge or close out.'
    case 'approved':
      if (input.app?.provider?.kycStatus && input.app.provider.kycStatus !== 'VERIFIED') {
        return `Verify KYC (current: ${input.app.provider.kycStatus.replace(/_/g, ' ')}).`
      }
      return 'Post-approval categories awaiting decision.'
    case 'conflict':
      return 'Resolve duplicate active application before approving.'
    case 'terminal':
      return 'No action required.'
    default: {
      const _exhaustive: never = input.bucket
      return _exhaustive
    }
  }
}

// ─── Main builder ────────────────────────────────────────────────────────────

export type BuildUnifiedRowsInput = {
  applications: ApplicationInput[]
  recoveryRows: ProviderOnboardingRecoveryRow[]
  assignments: Map<string, AssignmentInput>
  conflictingApplicationIds: Set<string>
  currentAdminId?: string | null
  now?: Date
}

export function buildUnifiedRows(input: BuildUnifiedRowsInput): UnifiedApplicationRow[] {
  const now = input.now ?? new Date()
  // Merge recovery rows into application rows by the keyed HMAC pseudonym
  // (safeUserRef) rather than the raw last-4 phone tail — the tail is PII and was
  // removed from the recovery row. safeUserRef is stable across both sides because
  // the application side recomputes it from app.phone with the same secret.
  const recoveryBySafeRef = new Map<string, ProviderOnboardingRecoveryRow>()

  for (const row of input.recoveryRows) {
    const existing = recoveryBySafeRef.get(row.safeUserRef)
    if (!existing || existing.lastInteractionAt < row.lastInteractionAt) {
      recoveryBySafeRef.set(row.safeUserRef, row)
    }
  }

  const consumedRecoveryRefs = new Set<string>()
  const rows: UnifiedApplicationRow[] = []

  for (const app of input.applications) {
    const phoneKey = phoneKeyFor(app.phone)
    const tail = phoneTailFor(app.phone)
    const appSafeRef = safeRefForPhone(app.phone)
    const recovery = recoveryBySafeRef.get(appSafeRef) ?? null
    if (recovery) consumedRecoveryRefs.add(recovery.safeUserRef)

    const completeness = evaluateApplicationCompleteness(app)
    const hasConflict = input.conflictingApplicationIds.has(app.id)
    const assignment = input.assignments.get(app.id) ?? null

    let bucket = bucketForApplication({ app, completeness, hasConflict })
    if (app.status === 'PENDING' && !completeness.canApprove && !hasConflict) {
      bucket = recovery && recovery.stage !== 'submitted' && recovery.stage !== 'pending'
        ? 'stuck_mid_flow'
        : 'idle'
    }

    const profilePhotoId =
      app.attachments.find((a) => a.label === PROVIDER_PROFILE_PHOTO_LABEL)?.id ?? null

    rows.push({
      rowId: `app:${app.id}`,
      phoneKey,
      phoneTail: tail,
      phoneMasked: maskPhone(app.phone),
      application: app,
      recovery,
      name: app.name || null,
      primarySkill: app.skills[0] ?? null,
      primaryArea: app.serviceAreas[0] ?? null,
      source: inferSource({ application: app, recovery }),
      completeness,
      hasConflict,
      assignment,
      bucket,
      priority: priorityForBucket(bucket),
      lastActivityAt: latestActivity(app, recovery),
      recommendedAction: recommendedActionFor({
        bucket,
        app,
        completeness,
        recovery,
        hasConflict,
      }),
      flags: {
        hasIdNumber: hasApplicationIdNumber(app),
        hasProfilePhoto: Boolean(profilePhotoId || app.provider?.avatarUrl),
        attachmentCount: app._count.attachments,
        kycStatus: app.provider?.kycStatus ?? null,
        outsideSessionWindow: recovery
          ? now.getTime() - recovery.lastInteractionAt.getTime() > 23 * 60 * 60_000
          : false,
        claimedByCurrentUser: Boolean(
          input.currentAdminId &&
            assignment?.claimedById &&
            assignment.claimedById === input.currentAdminId,
        ),
      },
    })
  }

  for (const recovery of input.recoveryRows) {
    if (consumedRecoveryRefs.has(recovery.safeUserRef)) continue
    const bucket = bucketForRecoveryOnly(recovery)
    rows.push({
      rowId: `rec:${recovery.id}`,
      // Recovery-only rows carry no raw phone (PII removed) — key on the HMAC
      // pseudonym and leave the application-derived tail empty.
      phoneKey: `ref:${recovery.safeUserRef}`,
      phoneTail: '',
      phoneMasked: recovery.phoneMasked,
      application: null,
      recovery,
      name: recovery.providerName,
      primarySkill: recovery.serviceCategory,
      primaryArea: recovery.area,
      source: 'whatsapp',
      completeness: null,
      hasConflict: recovery.stage === 'flow_conflict',
      assignment: null,
      bucket,
      priority: priorityForBucket(bucket),
      lastActivityAt: recovery.lastInteractionAt,
      recommendedAction: recommendedActionFor({
        bucket,
        app: null,
        completeness: null,
        recovery,
        hasConflict: recovery.stage === 'flow_conflict',
      }),
      flags: {
        hasIdNumber: false,
        hasProfilePhoto: false,
        attachmentCount: 0,
        kycStatus: null,
        outsideSessionWindow:
          now.getTime() - recovery.lastInteractionAt.getTime() > 23 * 60 * 60_000,
        claimedByCurrentUser: false,
      },
    })
  }

  return sortRows(rows)
}

function latestActivity(app: ApplicationInput, recovery: ProviderOnboardingRecoveryRow | null): Date {
  const dates: Date[] = [app.submittedAt]
  if (app.reviewedAt) dates.push(app.reviewedAt)
  if (recovery) dates.push(recovery.lastInteractionAt)
  return dates.sort((a, b) => b.getTime() - a.getTime())[0]
}

function sortRows(rows: UnifiedApplicationRow[]): UnifiedApplicationRow[] {
  return [...rows].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
  })
}

// ─── Counts ──────────────────────────────────────────────────────────────────

export type QueueCounts = Record<QueueBucket, number> & { total: number }

export function computeQueueCounts(rows: UnifiedApplicationRow[]): QueueCounts {
  const counts: QueueCounts = {
    ready_to_review: 0,
    stuck_mid_flow: 0,
    more_info: 0,
    idle: 0,
    conflict: 0,
    approved: 0,
    terminal: 0,
    total: rows.length,
  }
  for (const row of rows) counts[row.bucket] += 1
  return counts
}

// ─── Filtering ───────────────────────────────────────────────────────────────

export type WorklistFilters = {
  bucket?: QueueBucket | null
  query?: string | null
  source?: RowSource | null
  kyc?: KycStatus | 'none' | null
  hasIdNumber?: boolean | null
  hasProfilePhoto?: boolean | null
  claimedOnly?: boolean | null
  unclaimedOnly?: boolean | null
}

export function applyFilters(
  rows: UnifiedApplicationRow[],
  filters: WorklistFilters,
): UnifiedApplicationRow[] {
  const queryDigits = filters.query?.replace(/\D/g, '') ?? ''
  const queryText = filters.query?.toLowerCase().trim() ?? ''

  return rows.filter((row) => {
    if (filters.bucket && row.bucket !== filters.bucket) return false
    if (filters.source && row.source !== filters.source) return false
    if (filters.kyc) {
      if (filters.kyc === 'none') {
        if (row.flags.kycStatus) return false
      } else if (row.flags.kycStatus !== filters.kyc) {
        return false
      }
    }
    if (filters.hasIdNumber === true && !row.flags.hasIdNumber) return false
    if (filters.hasIdNumber === false && row.flags.hasIdNumber) return false
    if (filters.hasProfilePhoto === true && !row.flags.hasProfilePhoto) return false
    if (filters.hasProfilePhoto === false && row.flags.hasProfilePhoto) return false
    if (filters.claimedOnly && !row.assignment?.claimedById) return false
    if (filters.unclaimedOnly && row.assignment?.claimedById) return false
    if (queryText) {
      const haystacks: string[] = []
      if (row.name) haystacks.push(row.name.toLowerCase())
      if (row.primarySkill) haystacks.push(row.primarySkill.toLowerCase())
      if (row.primaryArea) haystacks.push(row.primaryArea.toLowerCase())
      if (row.application) haystacks.push(row.application.id.slice(-8).toLowerCase())
      const phoneDigits = row.phoneKey.replace(/\D/g, '')
      const matchesPhone = queryDigits.length >= 3 && phoneDigits.includes(queryDigits)
      const matchesText = haystacks.some((h) => h.includes(queryText))
      if (!matchesPhone && !matchesText) return false
    }
    return true
  })
}

// ─── URL <-> filter helpers ──────────────────────────────────────────────────

export function filtersFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): WorklistFilters {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key)
    const v = params[key]
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }
  const bucket = get('queue')
  const source = get('src')
  const kyc = get('kyc')
  return {
    bucket: isQueueBucket(bucket) ? bucket : null,
    query: get('q'),
    source: isRowSource(source) ? source : null,
    kyc: isKycFilter(kyc) ? kyc : null,
    hasIdNumber: ternary(get('id')),
    hasProfilePhoto: ternary(get('photo')),
    claimedOnly: get('claimed') === '1' ? true : null,
    unclaimedOnly: get('unclaimed') === '1' ? true : null,
  }
}

export function filtersToQueryString(filters: WorklistFilters): string {
  const params = new URLSearchParams()
  if (filters.bucket) params.set('queue', filters.bucket)
  if (filters.query) params.set('q', filters.query)
  if (filters.source) params.set('src', filters.source)
  if (filters.kyc) params.set('kyc', filters.kyc)
  if (filters.hasIdNumber === true) params.set('id', '1')
  if (filters.hasIdNumber === false) params.set('id', '0')
  if (filters.hasProfilePhoto === true) params.set('photo', '1')
  if (filters.hasProfilePhoto === false) params.set('photo', '0')
  if (filters.claimedOnly) params.set('claimed', '1')
  if (filters.unclaimedOnly) params.set('unclaimed', '1')
  return params.toString()
}

function ternary(value: string | null): boolean | null {
  if (value === '1') return true
  if (value === '0') return false
  return null
}

function isQueueBucket(value: string | null): value is QueueBucket {
  return value !== null && BUCKET_ORDER.includes(value as QueueBucket)
}

function isRowSource(value: string | null): value is RowSource {
  return value === 'whatsapp' || value === 'pwa' || value === 'admin' || value === 'unknown'
}

const KYC_FILTER_VALUES: ReadonlySet<string> = new Set([
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'none',
])

function isKycFilter(value: string | null): value is KycStatus | 'none' {
  return value !== null && KYC_FILTER_VALUES.has(value)
}

export function stageLabel(stage: ProviderOnboardingRecoveryRow['stage']): string {
  return providerOnboardingStageLabel(stage)
}
