import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_RECOVERY_STAGE_LABELS,
  RECOVERY_MESSAGE_TEMPLATES,
  buildDailyActivationReport,
  classifyProviderOnboardingRecovery,
  getRecoveryMessageTemplate,
  getRecommendedNextAction,
  maskRecoveryPhone,
  shouldSendAutomatedOnboardingNudge,
  type OnboardingRecoveryAuditEvent,
  type OnboardingRecoveryConversationInput,
} from '@/lib/provider-onboarding-recovery'

const NOW = new Date('2026-06-04T08:00:00.000Z')

function minutesAgo(minutes: number) {
  return new Date(NOW.getTime() - minutes * 60_000)
}

function conversation(
  flow: string,
  step: string,
  data: Record<string, unknown> = {},
  ageMinutes = 20,
): OnboardingRecoveryConversationInput {
  return {
    id: `conv-${flow}-${step}`,
    phone: '+27821234567',
    flow,
    step,
    data,
    createdAt: minutesAgo(ageMinutes + 10),
    updatedAt: minutesAgo(ageMinutes),
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
  }
}

function application(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `app-${status.toLowerCase()}`,
    phone: '+27821234567',
    status,
    providerId: null,
    skills: ['Plumbing'],
    serviceAreas: ['Roodepoort'],
    submittedAt: minutesAgo(10),
    updatedAt: minutesAgo(5),
    ...overrides,
  }
}

describe('classifyProviderOnboardingRecovery', () => {
  it.each([
    [conversation('idle', 'welcome'), null, null, 'idle_welcome'],
    [conversation('registration', 'reg_collect_skills'), null, null, 'register_no_name'],
    [conversation('registration', 'reg_verify_upload_doc', { name: 'Thabo Mokoena' }), null, null, 'id_verification_stuck'],
    [conversation('registration', 'reg_collect_skills_more', { name: 'Thabo Mokoena' }), null, null, 'skills_picker_stuck'],
    [conversation('registration', 'reg_collect_city', { name: 'Thabo Mokoena', skills: ['Plumbing'] }), null, null, 'location_picker_stuck'],
    [conversation('registration', 'reg_collect_evidence', { name: 'Thabo Mokoena', skills: ['Plumbing'], city: 'Johannesburg' }), null, null, 'evidence_upload_stuck'],
    [conversation('job_request', 'browse_categories', { intendedFlow: 'registration' }), null, null, 'flow_conflict'],
    [conversation('idle', 'welcome'), application('PENDING'), null, 'submitted_pending'],
    [conversation('idle', 'welcome'), application('APPROVED'), null, 'submitted_approved'],
    [conversation('provider_journey', 'pj_menu'), application('APPROVED'), { id: 'prov-1', status: 'ACTIVE', active: true, verified: true }, 'completed'],
    [conversation('registration', 'reg_unknown'), null, null, 'unknown'],
  ] as const)('maps %s/%s to %s', (conv, app, provider, expectedStage) => {
    expect(classifyProviderOnboardingRecovery({ conversation: conv, application: app, provider }).stage).toBe(expectedStage)
  })

  it('returns operator-facing labels for every recovery stage', () => {
    expect(ONBOARDING_RECOVERY_STAGE_LABELS).toMatchObject({
      idle_welcome: 'Stuck at welcome',
      register_no_name: 'Tapped Register but no name typed',
      id_verification_stuck: 'Stuck at ID verification',
      skills_picker_stuck: 'Stuck at skills picker',
      location_picker_stuck: 'Stuck at city/location picker',
      evidence_upload_stuck: 'Near finish: evidence upload',
      flow_conflict: 'Flow conflict: customer/provider mixup',
      submitted_pending: 'Submitted: pending review',
      submitted_approved: 'Submitted: approved',
    })
  })
})

describe('recovery templates', () => {
  it.each([
    'idle_welcome',
    'register_no_name',
    'id_verification_stuck',
    'skills_picker_stuck',
    'location_picker_stuck',
    'evidence_upload_stuck',
    'submitted_pending',
    'flow_conflict',
  ] as const)('has a stage-specific message for %s', (stage) => {
    expect(getRecoveryMessageTemplate(stage)).toBe(RECOVERY_MESSAGE_TEMPLATES[stage])
    expect(getRecommendedNextAction(stage).length).toBeGreaterThan(8)
  })

  it('keeps sensitive document actions inside the secure flow', () => {
    expect(getRecoveryMessageTemplate('id_verification_stuck')).toContain('secure registration link')
    expect(getRecoveryMessageTemplate('evidence_upload_stuck')).toContain('secure registration link')
    expect(getRecoveryMessageTemplate('id_verification_stuck')).not.toContain('send ID documents here.')
  })

  it('masks phones without exposing the full number', () => {
    expect(maskRecoveryPhone('+27821234567')).toBe('+2782***4567')
  })
})

describe('shouldSendAutomatedOnboardingNudge', () => {
  it.each([
    ['idle_welcome', 14, false],
    ['idle_welcome', 15, true],
    ['register_no_name', 15, true],
    ['skills_picker_stuck', 29, false],
    ['skills_picker_stuck', 30, true],
    ['evidence_upload_stuck', 30, true],
    ['submitted_pending', 120, false],
    ['submitted_approved', 120, false],
    ['completed', 120, false],
  ] as const)('stage=%s age=%s minutes eligible=%s', (stage, ageMinutes, expected) => {
    const result = shouldSendAutomatedOnboardingNudge({
      stage,
      lastStateUpdateAt: minutesAgo(ageMinutes),
      now: NOW,
      recentAuditEvents: [],
    })
    expect(result.eligible).toBe(expected)
  })

  it('does not send duplicate automated nudges for the same stage', () => {
    const recentAuditEvents: OnboardingRecoveryAuditEvent[] = [{
      actionType: 'automated_nudge_sent',
      stage: 'register_no_name',
      createdAt: minutesAgo(2),
      result: 'sent',
    }]

    expect(shouldSendAutomatedOnboardingNudge({
      stage: 'register_no_name',
      lastStateUpdateAt: minutesAgo(30),
      now: NOW,
      recentAuditEvents,
    })).toMatchObject({ eligible: false, reason: 'stage_already_nudged' })
  })

  it('caps automated nudges at three per user per 24 hours', () => {
    const recentAuditEvents: OnboardingRecoveryAuditEvent[] = [
      { actionType: 'automated_nudge_sent', stage: 'idle_welcome', createdAt: minutesAgo(60), result: 'sent' },
      { actionType: 'automated_nudge_sent', stage: 'register_no_name', createdAt: minutesAgo(50), result: 'sent' },
      { actionType: 'automated_nudge_sent', stage: 'skills_picker_stuck', createdAt: minutesAgo(40), result: 'sent' },
    ]

    expect(shouldSendAutomatedOnboardingNudge({
      stage: 'location_picker_stuck',
      lastStateUpdateAt: minutesAgo(45),
      now: NOW,
      recentAuditEvents,
    })).toMatchObject({ eligible: false, reason: 'daily_cap_reached' })
  })
})

describe('buildDailyActivationReport', () => {
  it('deduplicates inbound users by canonical phone and prioritises follow-up rows', () => {
    const report = buildDailyActivationReport({
      from: new Date('2026-06-04T06:00:00.000Z'),
      to: NOW,
      inboundPhones: ['0821234567', '+27821234567', '071 234 5678'],
      rows: [
        {
          phoneTail: '4567',
          maskedPhone: '+2782***4567',
          stage: 'idle_welcome',
          label: 'Stuck at welcome',
          lastStateUpdateAt: minutesAgo(20),
          recommendedNextAction: 'Ask whether they want to register.',
          templateKey: 'idle_welcome',
          followUpMessage: 'idle',
        },
        {
          phoneTail: '5678',
          maskedPhone: '+2771***5678',
          stage: 'evidence_upload_stuck',
          label: 'Near finish: evidence upload',
          lastStateUpdateAt: minutesAgo(45),
          recommendedNextAction: 'Help finish evidence upload.',
          templateKey: 'evidence_upload_stuck',
          followUpMessage: 'evidence',
        },
      ],
    })

    expect(report.totalInboundWhatsAppUsers).toBe(2)
    expect(report.dropOffCounts).toMatchObject({ idle_welcome: 1, evidence_upload_stuck: 1 })
    expect(report.usersRequiringFollowUp).toBe(2)
    expect(report.topRecoveryPriorityList.map((row) => row.stage)).toEqual([
      'evidence_upload_stuck',
      'idle_welcome',
    ])
  })
})
