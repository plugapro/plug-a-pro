import { describe, expect, it } from 'vitest'
import {
  filterAdminActionableRecoveryRows,
  WHATSAPP_RECOVERY_SESSION_WINDOW_MS,
  type ProviderOnboardingRecoveryRow,
} from '@/lib/provider-onboarding-recovery'

const NOW = new Date('2026-06-09T10:00:00.000Z')

function row(overrides: Partial<ProviderOnboardingRecoveryRow> = {}): ProviderOnboardingRecoveryRow {
  return {
    id: 'row-1',
    source: 'conversation',
    safeUserRef: 'phn:abc',
    phoneMasked: '••••••',
    phoneTail: '0000',
    providerName: null,
    serviceCategory: null,
    area: null,
    applicationStatus: null,
    stage: 'skills_picker',
    priority: 2,
    priorityLabel: 'P2',
    flow: 'registration',
    step: 'reg_collect_skills',
    firstSeenAt: new Date(NOW.getTime() - 60 * 60_000),
    lastInteractionAt: new Date(NOW.getTime() - 60 * 60_000),
    messageCount: 1,
    messageTypes: ['text'],
    recommendedAction: 'Ask for skills',
    messageTemplateKey: 'started_blocked',
    followUpMessage: 'Hi…',
    followUpDueAt: null,
    followUpStatus: 'due',
    lastOutcomeStatus: 'not_contacted',
    lastOutcomeAt: null,
    operatorNotes: null,
    nextFollowUpAt: null,
    ...overrides,
  }
}

describe('filterAdminActionableRecoveryRows', () => {
  it('keeps not_contacted rows that are inside the 23h session window and on an actionable stage', () => {
    const keep = row({ id: 'keep', lastInteractionAt: new Date(NOW.getTime() - 60 * 60_000) })
    const result = filterAdminActionableRecoveryRows([keep], NOW)
    expect(result.map((r) => r.id)).toEqual(['keep'])
  })

  it('drops rows the cron or another operator already sent (lastOutcomeStatus !== not_contacted)', () => {
    const sent = row({ id: 'sent', lastOutcomeStatus: 'message_sent' })
    const result = filterAdminActionableRecoveryRows([sent], NOW)
    expect(result).toEqual([])
  })

  it('drops rows whose last interaction is older than the 23h session window', () => {
    const stale = row({
      id: 'stale',
      lastInteractionAt: new Date(NOW.getTime() - WHATSAPP_RECOVERY_SESSION_WINDOW_MS - 60_000),
    })
    const result = filterAdminActionableRecoveryRows([stale], NOW)
    expect(result).toEqual([])
  })

  it('keeps rows exactly at the 23h session window boundary (inclusive)', () => {
    const edge = row({
      id: 'edge',
      lastInteractionAt: new Date(NOW.getTime() - WHATSAPP_RECOVERY_SESSION_WINDOW_MS),
    })
    const result = filterAdminActionableRecoveryRows([edge], NOW)
    expect(result.map((r) => r.id)).toEqual(['edge'])
  })

  it('drops rows on the submitted_no_recovery template (no Send button surfaces)', () => {
    const submitted = row({
      id: 'submitted',
      stage: 'submitted',
      messageTemplateKey: 'submitted_no_recovery',
      applicationStatus: 'PENDING',
    })
    const result = filterAdminActionableRecoveryRows([submitted], NOW)
    expect(result).toEqual([])
  })

  it('returns rows from a mixed input in their original order', () => {
    const keep = row({ id: 'keep' })
    const sent = row({ id: 'sent', lastOutcomeStatus: 'message_sent' })
    const stale = row({
      id: 'stale',
      lastInteractionAt: new Date(NOW.getTime() - WHATSAPP_RECOVERY_SESSION_WINDOW_MS - 60_000),
    })
    const submitted = row({
      id: 'submitted',
      stage: 'submitted',
      messageTemplateKey: 'submitted_no_recovery',
    })
    const result = filterAdminActionableRecoveryRows([keep, sent, stale, submitted], NOW)
    expect(result.map((r) => r.id)).toEqual(['keep'])
  })

  it('defaults `now` to the current time when omitted', () => {
    const keep = row({ id: 'keep', lastInteractionAt: new Date(Date.now() - 60 * 60_000) })
    expect(filterAdminActionableRecoveryRows([keep])).toHaveLength(1)
  })
})
