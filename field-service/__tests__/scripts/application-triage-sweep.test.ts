import { describe, expect, it } from 'vitest'
import { classifyApplication, type TriageInput } from '../../scripts/application-triage-sweep'

const base: TriageInput = {
  id: 'app-1',
  name: 'Sipho Test',
  phone: '+27820000001',
  skills: ['plumbing', 'painting'],
  serviceAreas: ['Honeydew', 'Florida'],
  idNumber: '9001015800081',
  status: 'PENDING',
  notes: null,
  hasVerificationRow: false,
  isActiveProviderPhone: false,
}

describe('classifyApplication', () => {
  it('rule 0: active-provider phone → DUPLICATE, no change, no send', () => {
    const d = classifyApplication({ ...base, isActiveProviderPhone: true })
    expect(d.rule).toBe('DUPLICATE')
    expect(d.targetStatus).toBeNull()
    expect(d.template).toBeNull()
  })

  it('idempotency: notes containing [triage-sweep → SKIP_ALREADY_SWEPT', () => {
    const d = classifyApplication({ ...base, notes: 'prev [triage-sweep 2026-07-01 rule-2]' })
    expect(d.rule).toBe('SKIP_ALREADY_SWEPT')
    expect(d.targetStatus).toBeNull()
  })

  it('rule 3: no pilot-suburb overlap → park + waitlist + area label', () => {
    const d = classifyApplication({ ...base, serviceAreas: ['Midrand', 'Centurion'] })
    expect(d.rule).toBe('RULE_3_OUT_OF_PILOT')
    expect(d.template).toBe('provider_area_waitlist')
    expect(d.waitlist).toBe(true)
    expect(d.areaLabel).toBe('Midrand')
    // has ID → stays PENDING
    expect(d.targetStatus).toBeNull()
  })

  it('rule 3 + no ID → MORE_INFO_REQUIRED while parked', () => {
    const d = classifyApplication({ ...base, serviceAreas: ['Midrand'], idNumber: null })
    expect(d.rule).toBe('RULE_3_OUT_OF_PILOT')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
  })

  it('rule 1: in-pilot, no idNumber, no verification row → MORE_INFO + resume nudge', () => {
    const d = classifyApplication({ ...base, idNumber: null })
    expect(d.rule).toBe('RULE_1_NO_ID')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
    expect(d.template).toBe('provider_registration_continue')
  })

  it('rule 1 exception: verification row counts as ID captured (Bernard edge)', () => {
    const d = classifyApplication({ ...base, idNumber: null, hasVerificationRow: true })
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
  })

  it('rule 2: in-pilot multi-skill with ID → APPROVED minus high-risk + cert nudge', () => {
    const d = classifyApplication(base)
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
    expect(d.targetStatus).toBe('APPROVED')
    expect(d.approvedSkills).toEqual(['painting'])
    expect(d.heldSkills).toEqual(['plumbing'])
    expect(d.template).toBe('provider_high_risk_cert_nudge')
  })

  it('rule 2 holds geysers too (any non-standard risk level)', () => {
    const d = classifyApplication({ ...base, skills: ['geysers', 'painting', 'plumbing'] })
    expect(d.heldSkills).toEqual(expect.arrayContaining(['plumbing', 'geysers']))
    expect(d.approvedSkills).toEqual(['painting'])
  })

  it('rule 2b: plumbing-only with ID → MORE_INFO + cert nudge, nothing approved', () => {
    const d = classifyApplication({ ...base, skills: ['plumbing'] })
    expect(d.rule).toBe('RULE_2B_HIGH_RISK_ONLY')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
    expect(d.approvedSkills).toBeNull()
    expect(d.template).toBe('provider_high_risk_cert_nudge')
  })

  it('normalises mixed-case skills and areas ("Plumbing", "Constantia Kloof")', () => {
    const d = classifyApplication({ ...base, skills: ['Plumbing', 'Painting'], serviceAreas: ['Constantia Kloof'] })
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
    expect(d.heldSkills).toEqual(['plumbing'])
  })
})
