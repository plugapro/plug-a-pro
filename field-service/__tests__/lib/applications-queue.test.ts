import { describe, expect, it } from 'vitest'
import type { ApplicationStatus } from '@prisma/client'
import {
  safeRefForPhone,
  type ProviderOnboardingRecoveryRow,
} from '@/lib/provider-onboarding-recovery'
import {
  applyFilters,
  BUCKET_ORDER,
  buildUnifiedRows,
  computeQueueCounts,
  filtersFromSearchParams,
  filtersToQueryString,
  maskPhone,
  phoneKeyFor,
  phoneTailFor,
  priorityForBucket,
  type ApplicationInput,
  type AssignmentInput,
} from '@/lib/applications-queue'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeApp(overrides: Partial<ApplicationInput> = {}): ApplicationInput {
  const defaults: ApplicationInput = {
    id: 'app_1',
    providerId: null,
    phone: '+27821234567',
    name: 'Lebogang Mokoena',
    skills: ['plumbing'],
    serviceAreas: ['Centurion'],
    experience: '3-5 years',
    availability: 'Mon-Sat',
    callOutFee: 250,
    idNumber: '8001015009087',
    status: 'PENDING' as ApplicationStatus,
    submittedAt: new Date('2026-06-08T08:00:00Z'),
    reviewedAt: null,
    notes: null,
    evidenceNote: null,
    evidenceFileUrls: [],
    attachments: [
      {
        id: 'att_photo',
        url: 'https://example/photo.jpg',
        label: 'profile_photo',
        mimeType: 'image/jpeg',
        safeForPreview: true,
        uploadedBy: 'whatsapp',
        createdAt: new Date('2026-06-08T07:50:00Z'),
      },
    ],
    provider: null,
    _count: { attachments: 1 },
  }
  return { ...defaults, ...overrides }
}

function makeRecovery(overrides: Partial<ProviderOnboardingRecoveryRow> = {}): ProviderOnboardingRecoveryRow {
  return {
    id: overrides.id ?? 'rec_1',
    source: overrides.source ?? 'conversation',
    safeUserRef: overrides.safeUserRef ?? 'wa_abc123def0',
    phoneMasked: overrides.phoneMasked ?? '+27 ••• ••• 4567',
    providerName: overrides.providerName ?? null,
    serviceCategory: overrides.serviceCategory ?? null,
    area: overrides.area ?? null,
    applicationStatus: overrides.applicationStatus ?? null,
    stage: overrides.stage ?? 'evidence_upload',
    priority: overrides.priority ?? 1,
    priorityLabel: overrides.priorityLabel ?? 'P1',
    flow: overrides.flow ?? 'registration',
    step: overrides.step ?? 'reg_evidence',
    firstSeenAt: overrides.firstSeenAt ?? new Date('2026-06-08T07:00:00Z'),
    lastInteractionAt: overrides.lastInteractionAt ?? new Date('2026-06-08T07:30:00Z'),
    messageCount: overrides.messageCount ?? 3,
    messageTypes: overrides.messageTypes ?? ['text'],
    recommendedAction: overrides.recommendedAction ?? 'Send evidence upload nudge.',
    messageTemplateKey: overrides.messageTemplateKey ?? 'evidence_upload',
    followUpMessage: overrides.followUpMessage ?? 'Reminder text…',
    followUpDueAt: overrides.followUpDueAt ?? new Date('2026-06-08T08:00:00Z'),
    followUpStatus: overrides.followUpStatus ?? 'due',
    lastOutcomeStatus: overrides.lastOutcomeStatus ?? 'not_contacted',
    lastOutcomeAt: overrides.lastOutcomeAt ?? null,
    operatorNotes: overrides.operatorNotes ?? null,
    nextFollowUpAt: overrides.nextFollowUpAt ?? null,
  } as ProviderOnboardingRecoveryRow
}

function noAssignments(): Map<string, AssignmentInput> {
  return new Map()
}

const now = new Date('2026-06-08T09:00:00Z')

// ─── Phone helpers ───────────────────────────────────────────────────────────

describe('phone helpers', () => {
  it('normalises SA local 0xx into E.164', () => {
    expect(phoneKeyFor('0821234567')).toBe('+27821234567')
  })

  it('returns last 4 digits as phoneTail', () => {
    expect(phoneTailFor('+27821234567')).toBe('4567')
  })

  it('masks SA numbers with last 4 visible', () => {
    expect(maskPhone('+27821234567')).toBe('+27 ••• ••• 4567')
  })

  it('handles short / invalid phone safely', () => {
    expect(maskPhone('123')).toBe('••• ••• ••••')
  })
})

// ─── Bucket classification ───────────────────────────────────────────────────

describe('buildUnifiedRows — bucket classification', () => {
  it('puts a complete PENDING with no conflict into ready_to_review (P1)', () => {
    const rows = buildUnifiedRows({
      applications: [makeApp()],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].bucket).toBe('ready_to_review')
    expect(rows[0].priority).toBe(1)
    expect(rows[0].completeness?.canApprove).toBe(true)
  })

  it('puts a PENDING missing required fields into idle (P4) when no recovery row', () => {
    const rows = buildUnifiedRows({
      applications: [makeApp({ id: 'app_x', serviceAreas: [], skills: [] })],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('idle')
    expect(rows[0].priority).toBe(4)
    expect(rows[0].completeness?.canApprove).toBe(false)
  })

  it('upgrades a PENDING with missing fields + active recovery row to stuck_mid_flow (P2)', () => {
    const app = makeApp({ id: 'app_stuck', serviceAreas: [], phone: '+27821119999' })
    const recovery = makeRecovery({ safeUserRef: safeRefForPhone('+27821119999'), stage: 'evidence_upload' })
    const rows = buildUnifiedRows({
      applications: [app],
      recoveryRows: [recovery],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('stuck_mid_flow')
    expect(rows[0].priority).toBe(2)
    expect(rows[0].recovery).toBeTruthy()
  })

  it('tags a conflicting PENDING into conflict (P3)', () => {
    const app = makeApp({ id: 'app_conf' })
    const rows = buildUnifiedRows({
      applications: [app],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(['app_conf']),
      now,
    })
    expect(rows[0].bucket).toBe('conflict')
    expect(rows[0].priority).toBe(3)
    expect(rows[0].hasConflict).toBe(true)
  })

  it('places MORE_INFO_REQUIRED into more_info (P3)', () => {
    const rows = buildUnifiedRows({
      applications: [makeApp({ status: 'MORE_INFO_REQUIRED' })],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('more_info')
    expect(rows[0].priority).toBe(3)
  })

  it('places APPROVED into approved (P5)', () => {
    const rows = buildUnifiedRows({
      applications: [makeApp({ status: 'APPROVED' })],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('approved')
    expect(rows[0].priority).toBe(5)
  })

  it('places REJECTED into terminal (P6)', () => {
    const rows = buildUnifiedRows({
      applications: [makeApp({ status: 'REJECTED' })],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('terminal')
    expect(rows[0].priority).toBe(6)
  })

  it('places CANCELLED into terminal (P6)', () => {
    const rows = buildUnifiedRows({
      applications: [makeApp({ status: 'CANCELLED' })],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('terminal')
  })
})

// ─── Recovery merge ──────────────────────────────────────────────────────────

describe('buildUnifiedRows — recovery merge', () => {
  it('merges a recovery row into the application row when safeUserRef matches (no duplicate visual row)', () => {
    const app = makeApp({ phone: '+27821234567' })
    const recovery = makeRecovery({ safeUserRef: safeRefForPhone('+27821234567') })
    const rows = buildUnifiedRows({
      applications: [app],
      recoveryRows: [recovery],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].application).toBeTruthy()
    expect(rows[0].recovery).toBeTruthy()
  })

  it('emits a recovery-only row when no matching application exists', () => {
    const recovery = makeRecovery({ safeUserRef: 'wa_norecoverymatch' })
    const rows = buildUnifiedRows({
      applications: [],
      recoveryRows: [recovery],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].application).toBeNull()
    expect(rows[0].recovery).toBeTruthy()
    expect(rows[0].rowId.startsWith('rec:')).toBe(true)
  })

  it('places a recovery-only welcome_idle row into idle (P4)', () => {
    const rows = buildUnifiedRows({
      applications: [],
      recoveryRows: [makeRecovery({ safeUserRef: 'wa_idleonly', stage: 'welcome_idle' })],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('idle')
    expect(rows[0].priority).toBe(4)
  })

  it('places a recovery-only flow_conflict row into conflict (P3)', () => {
    const rows = buildUnifiedRows({
      applications: [],
      recoveryRows: [makeRecovery({ safeUserRef: 'wa_conflictonly', stage: 'flow_conflict' })],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].bucket).toBe('conflict')
    expect(rows[0].priority).toBe(3)
  })
})

// ─── Ordering ────────────────────────────────────────────────────────────────

describe('buildUnifiedRows — ordering', () => {
  it('sorts ready_to_review before stuck_mid_flow before idle', () => {
    const rows = buildUnifiedRows({
      applications: [
        makeApp({ id: 'a', status: 'APPROVED', phone: '+27820000001' }),
        makeApp({ id: 'b', status: 'PENDING', serviceAreas: [], skills: [], phone: '+27820000002' }), // idle
        makeApp({ id: 'c', status: 'PENDING', phone: '+27820000003' }), // ready
      ],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows.map((r) => r.application?.id)).toEqual(['c', 'b', 'a'])
  })

  it('within the same bucket, newer activity sorts first', () => {
    const rows = buildUnifiedRows({
      applications: [
        makeApp({ id: 'older', submittedAt: new Date('2026-06-01T00:00:00Z'), phone: '+27820000010' }),
        makeApp({ id: 'newer', submittedAt: new Date('2026-06-08T08:00:00Z'), phone: '+27820000011' }),
      ],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows.map((r) => r.application?.id)).toEqual(['newer', 'older'])
  })
})

// ─── Flags + assignment ─────────────────────────────────────────────────────

describe('buildUnifiedRows — flags', () => {
  it('flags claimedByCurrentUser when assignment matches', () => {
    const assignments = new Map<string, AssignmentInput>([
      ['app_1', { claimedById: 'admin_42', claimedByLabel: 'ops@plugapro' }],
    ])
    const rows = buildUnifiedRows({
      applications: [makeApp()],
      recoveryRows: [],
      assignments,
      conflictingApplicationIds: new Set(),
      currentAdminId: 'admin_42',
      now,
    })
    expect(rows[0].flags.claimedByCurrentUser).toBe(true)
  })

  it('flags outsideSessionWindow for recovery rows > 23h old', () => {
    const rows = buildUnifiedRows({
      applications: [],
      recoveryRows: [
        makeRecovery({
          safeUserRef: 'wa_outsidewindow',
          lastInteractionAt: new Date('2026-06-06T00:00:00Z'),
        }),
      ],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].flags.outsideSessionWindow).toBe(true)
  })

  it('reports hasIdNumber=false and missing profile photo correctly', () => {
    const rows = buildUnifiedRows({
      applications: [
        makeApp({ idNumber: null, attachments: [], _count: { attachments: 0 } }),
      ],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    expect(rows[0].flags.hasIdNumber).toBe(false)
    expect(rows[0].flags.hasProfilePhoto).toBe(false)
  })
})

// ─── Counts ──────────────────────────────────────────────────────────────────

describe('computeQueueCounts', () => {
  it('counts per bucket and total', () => {
    const rows = buildUnifiedRows({
      applications: [
        makeApp({ id: 'a', status: 'PENDING', phone: '+27821111111' }),
        makeApp({ id: 'b', status: 'APPROVED', phone: '+27822222222' }),
        makeApp({ id: 'c', status: 'REJECTED', phone: '+27823333333' }),
        makeApp({ id: 'd', status: 'MORE_INFO_REQUIRED', phone: '+27824444444' }),
      ],
      recoveryRows: [],
      assignments: noAssignments(),
      conflictingApplicationIds: new Set(),
      now,
    })
    const counts = computeQueueCounts(rows)
    expect(counts.total).toBe(4)
    expect(counts.ready_to_review).toBe(1)
    expect(counts.approved).toBe(1)
    expect(counts.terminal).toBe(1)
    expect(counts.more_info).toBe(1)
    expect(counts.stuck_mid_flow).toBe(0)
  })

  it('exposes all buckets in BUCKET_ORDER', () => {
    expect(BUCKET_ORDER).toEqual([
      'ready_to_review',
      'stuck_mid_flow',
      'more_info',
      'conflict',
      'idle',
      'approved',
      'terminal',
    ])
  })
})

// ─── Filtering ───────────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const rows = buildUnifiedRows({
    applications: [
      makeApp({ id: 'a', name: 'Alice', phone: '+27821111111' }),
      makeApp({ id: 'b', name: 'Bob', status: 'APPROVED', phone: '+27822222222' }),
      makeApp({
        id: 'c',
        name: 'Charlie',
        status: 'MORE_INFO_REQUIRED',
        phone: '+27823333333',
        idNumber: null,
      }),
    ],
    recoveryRows: [],
    assignments: noAssignments(),
    conflictingApplicationIds: new Set(),
    now,
  })

  it('filters by bucket', () => {
    const result = applyFilters(rows, { bucket: 'approved' })
    expect(result).toHaveLength(1)
    expect(result[0].application?.id).toBe('b')
  })

  it('filters by free-text name query (case-insensitive)', () => {
    const result = applyFilters(rows, { query: 'alic' })
    expect(result.map((r) => r.application?.id)).toEqual(['a'])
  })

  it('filters by phone digits (>=3 digit match)', () => {
    const result = applyFilters(rows, { query: '2222' })
    expect(result).toHaveLength(1)
    expect(result[0].application?.id).toBe('b')
  })

  it('filters by hasIdNumber=false', () => {
    const result = applyFilters(rows, { hasIdNumber: false })
    expect(result.map((r) => r.application?.id)).toEqual(['c'])
  })

  it('combines filters with AND semantics', () => {
    const result = applyFilters(rows, { bucket: 'more_info', hasIdNumber: false })
    expect(result.map((r) => r.application?.id)).toEqual(['c'])
  })

  it('returns empty when no row matches', () => {
    const result = applyFilters(rows, { query: 'zzz_nomatch' })
    expect(result).toHaveLength(0)
  })
})

// ─── URL <-> filter round-trip ───────────────────────────────────────────────

describe('filtersFromSearchParams / filtersToQueryString', () => {
  it('round-trips a typical filter set', () => {
    const original = {
      bucket: 'ready_to_review' as const,
      query: 'Lebogang',
      source: 'whatsapp' as const,
      kyc: 'VERIFIED' as const,
      hasIdNumber: true,
      hasProfilePhoto: false,
      claimedOnly: true,
      unclaimedOnly: null,
    }
    const qs = filtersToQueryString(original)
    const parsed = filtersFromSearchParams(new URLSearchParams(qs))
    expect(parsed.bucket).toBe(original.bucket)
    expect(parsed.query).toBe(original.query)
    expect(parsed.source).toBe(original.source)
    expect(parsed.kyc).toBe(original.kyc)
    expect(parsed.hasIdNumber).toBe(true)
    expect(parsed.hasProfilePhoto).toBe(false)
    expect(parsed.claimedOnly).toBe(true)
  })

  it('ignores unknown bucket / source / kyc values', () => {
    const parsed = filtersFromSearchParams({
      queue: 'not_a_queue',
      src: 'martian',
      kyc: 'INVALID',
    })
    expect(parsed.bucket).toBeNull()
    expect(parsed.source).toBeNull()
    expect(parsed.kyc).toBeNull()
  })
})

// ─── priorityForBucket ───────────────────────────────────────────────────────

describe('priorityForBucket', () => {
  it('returns 1-6 in expected order', () => {
    expect(priorityForBucket('ready_to_review')).toBe(1)
    expect(priorityForBucket('stuck_mid_flow')).toBe(2)
    expect(priorityForBucket('more_info')).toBe(3)
    expect(priorityForBucket('conflict')).toBe(3)
    expect(priorityForBucket('idle')).toBe(4)
    expect(priorityForBucket('approved')).toBe(5)
    expect(priorityForBucket('terminal')).toBe(6)
  })
})
