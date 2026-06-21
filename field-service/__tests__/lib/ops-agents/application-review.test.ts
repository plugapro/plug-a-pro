import { describe, it, expect } from 'vitest'
import {
  APPLICATION_CRITERIA,
  scoreApplication,
  classifyApplication,
  evaluateApplication,
  type ApplicationCandidate,
} from '../../../lib/ops-agents/agents/application-review/evaluator'

const ctx = { nowIso: '2026-06-21T09:00:00.000Z' }

function candidate(overrides: Partial<ApplicationCandidate> = {}): ApplicationCandidate {
  return {
    id: 'app_1',
    hasName: true,
    hasContact: true,
    phone: '+27600000000',
    categoryCount: 2,
    serviceAreaCount: 1,
    descriptionLength: 40,
    portfolioCount: 3,
    hasAvailability: true,
    hasExperience: true,
    hasIdNumber: true,
    hasRateInfo: true,
    inPilotArea: true,
    duplicateSignal: false,
    firstName: 'Thabo',
    ...overrides,
  }
}

describe('application-review scoring', () => {
  it('criteria weights sum to 100', () => {
    const total = APPLICATION_CRITERIA.reduce((s, c) => s + c.weight, 0)
    expect(total).toBe(100)
  })

  it('a fully complete application scores 100 with no gaps', () => {
    const { score, gaps } = scoreApplication(candidate())
    expect(score).toBe(100)
    expect(gaps).toHaveLength(0)
  })

  it('subtracts the exact weight of each missing criterion', () => {
    const { score, gaps } = scoreApplication(
      candidate({ portfolioCount: 0, hasIdNumber: false }),
    )
    // portfolio (15) + verification (10) missing
    expect(score).toBe(75)
    expect(gaps.map((g) => g.code).sort()).toEqual(['portfolio_photos', 'verification_documents'])
  })

  it('an empty application scores 0 with all criteria as gaps', () => {
    const empty = candidate({
      hasName: false,
      hasContact: false,
      phone: null,
      categoryCount: 0,
      serviceAreaCount: 0,
      descriptionLength: 0,
      portfolioCount: 0,
      hasAvailability: false,
      hasExperience: false,
      hasIdNumber: false,
      hasRateInfo: false,
      inPilotArea: null,
    })
    const { score, gaps } = scoreApplication(empty)
    expect(score).toBe(0)
    expect(gaps).toHaveLength(APPLICATION_CRITERIA.length)
  })
})

describe('application-review classification', () => {
  it('classifies a complete application as ready_for_ops_review', () => {
    expect(classifyApplication(candidate(), 100)).toBe('ready_for_ops_review')
  })

  it('classifies a mid-score application as high_potential_but_incomplete', () => {
    expect(classifyApplication(candidate(), 60)).toBe('high_potential_but_incomplete')
  })

  it('classifies a low-score application as needs_more_information', () => {
    expect(classifyApplication(candidate(), 30)).toBe('needs_more_information')
  })

  it('duplicate signal overrides score', () => {
    expect(classifyApplication(candidate({ duplicateSignal: true }), 100)).toBe(
      'duplicate_or_suspicious',
    )
  })

  it('out-of-pilot-area overrides score when areas are given', () => {
    expect(
      classifyApplication(candidate({ serviceAreaCount: 1, inPilotArea: false }), 100),
    ).toBe('unsuitable_for_current_pilot_area')
  })

  it('unknown pilot area (no areas given) does not force unsuitable', () => {
    expect(
      classifyApplication(candidate({ serviceAreaCount: 0, inPilotArea: null }), 90),
    ).toBe('ready_for_ops_review')
  })
})

describe('application-review evaluator output', () => {
  it('produces a full Evaluation for every application', () => {
    const e = evaluateApplication(candidate(), ctx)
    expect(e).not.toBeNull()
    expect(e!.agentKey).toBe('PROVIDER_APPLICATION_REVIEW')
    expect(e!.entityType).toBe('PROVIDER_APPLICATION')
    expect(e!.entityId).toBe('app_1')
    expect(e!.dedupeKey).toBe('PROVIDER_APPLICATION_REVIEW:app_1:review')
  })

  it('drafts a provider WhatsApp message ONLY when chasing missing info', () => {
    const incomplete = evaluateApplication(
      candidate({ portfolioCount: 0, descriptionLength: 0, hasExperience: false }),
      ctx,
    )!
    expect(incomplete.classification).not.toBe('ready_for_ops_review')
    expect(incomplete.draft).toBeDefined()
    expect(incomplete.draft!.channel).toBe('WHATSAPP')
    expect(incomplete.draft!.recipientRole).toBe('PROVIDER')
    expect(incomplete.draft!.recipientPhone).toBe('+27600000000')
    // lists the missing items
    expect(incomplete.draft!.freeformBody).toContain('Portfolio / work photos')
  })

  it('does NOT draft a message for a complete (ready) application', () => {
    const ready = evaluateApplication(candidate(), ctx)!
    expect(ready.classification).toBe('ready_for_ops_review')
    expect(ready.draft).toBeUndefined()
  })

  it('does NOT draft a message when there is no phone', () => {
    const noPhone = evaluateApplication(
      candidate({ phone: null, hasContact: false, portfolioCount: 0 }),
      ctx,
    )!
    expect(noPhone.draft).toBeUndefined()
  })

  it('emits a duplicate signal at HIGH severity', () => {
    const dup = evaluateApplication(candidate({ duplicateSignal: true }), ctx)!
    expect(dup.severity).toBe('HIGH')
    expect(dup.signals[0].code).toBe('duplicate_signal')
    expect(dup.draft).toBeUndefined()
  })
})
