import { describe, expect, it } from 'vitest'
import {
  classifyLeadResponseCohort,
  NO_SHOW_DEACTIVATION_THRESHOLD,
  type LeadResponseStats,
} from '@/lib/provider-lead-response-comms'

const base: LeadResponseStats = {
  leadsReceived: 0,
  leadsAccepted: 0,
  leadsDeclined: 0,
  isInternalTestPhone: false,
}

describe('classifyLeadResponseCohort', () => {
  it('deactivates a provider at the threshold with zero responses', () => {
    expect(
      classifyLeadResponseCohort({ ...base, leadsReceived: NO_SHOW_DEACTIVATION_THRESHOLD }),
    ).toBe('deactivate')
  })

  it('deactivates above the threshold too', () => {
    expect(
      classifyLeadResponseCohort({ ...base, leadsReceived: NO_SHOW_DEACTIVATION_THRESHOLD + 2 }),
    ).toBe('deactivate')
  })

  it('warns a provider with some leads but below the threshold', () => {
    expect(classifyLeadResponseCohort({ ...base, leadsReceived: 1 })).toBe('warn')
    expect(
      classifyLeadResponseCohort({ ...base, leadsReceived: NO_SHOW_DEACTIVATION_THRESHOLD - 1 }),
    ).toBe('warn')
  })

  it('skips a provider who has received no leads', () => {
    expect(classifyLeadResponseCohort({ ...base, leadsReceived: 0 })).toBe('skip')
  })

  it('skips any provider who has accepted a lead, regardless of volume', () => {
    expect(
      classifyLeadResponseCohort({ ...base, leadsReceived: 10, leadsAccepted: 1 }),
    ).toBe('skip')
  })

  it('treats a decline as engagement — never warns or deactivates a decliner', () => {
    // Below threshold: would otherwise be a warn.
    expect(
      classifyLeadResponseCohort({ ...base, leadsReceived: 2, leadsDeclined: 1 }),
    ).toBe('skip')
    // At/over threshold: would otherwise be a deactivate.
    expect(
      classifyLeadResponseCohort({
        ...base,
        leadsReceived: NO_SHOW_DEACTIVATION_THRESHOLD + 1,
        leadsDeclined: 1,
      }),
    ).toBe('skip')
  })

  it('always skips internal test accounts, even at the threshold', () => {
    expect(
      classifyLeadResponseCohort({
        ...base,
        leadsReceived: NO_SHOW_DEACTIVATION_THRESHOLD,
        isInternalTestPhone: true,
      }),
    ).toBe('skip')
  })
})
