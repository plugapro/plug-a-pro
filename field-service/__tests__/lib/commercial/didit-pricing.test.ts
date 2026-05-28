import { describe, expect, it } from 'vitest'
import {
  DIDIT_PRICING,
  applyOverrides,
  centsToDollars,
  estimateDiditCost,
} from '../../../lib/commercial/didit-pricing'

describe('estimateDiditCost', () => {
  it('returns $0.53 for Didit Basic KYC + AML (spec §6.6)', () => {
    const result = estimateDiditCost({ workflowProfile: 'KYC_BASIC' })
    expect(result.centsUsd).toBe(53)
    expect(centsToDollars(result.centsUsd)).toBe(0.53)
    expect(result.lineItems.map(item => item.key)).toEqual(['KYC_BASIC', 'AML'])
  })

  it('returns $3.48 for Didit Authoritative SA KYC (includes DHA by default) (spec §6.6)', () => {
    const result = estimateDiditCost({ workflowProfile: 'KYC_AUTHORITATIVE' })
    expect(result.centsUsd).toBe(348)
    expect(centsToDollars(result.centsUsd)).toBe(3.48)
    expect(result.lineItems.map(item => item.key)).toEqual(['KYC_BASIC', 'AML', 'DHA'])
  })

  it('includes ongoing AML as a separate $0.07/user/year line item when requested (spec §6.6)', () => {
    const result = estimateDiditCost({
      workflowProfile: 'KYC_AUTHORITATIVE',
      includeAmlOngoing: true,
    })
    expect(result.centsUsd).toBe(355)
    const ongoing = result.lineItems.find(item => item.key === 'AML_ONGOING')
    expect(ongoing).toEqual({
      key: 'AML_ONGOING',
      label: 'Ongoing AML monitoring (per user/year)',
      centsUsd: 7,
    })
  })

  it('allows opting out of DHA on the authoritative workflow', () => {
    const result = estimateDiditCost({
      workflowProfile: 'KYC_AUTHORITATIVE',
      includeDha: false,
    })
    expect(result.centsUsd).toBe(53)
    expect(result.lineItems.map(item => item.key)).toEqual(['KYC_BASIC', 'AML'])
  })

  it('supports basic workflow + ongoing AML', () => {
    const result = estimateDiditCost({
      workflowProfile: 'KYC_BASIC',
      includeAmlOngoing: true,
    })
    expect(result.centsUsd).toBe(60)
    expect(result.lineItems.map(item => item.key)).toEqual(['KYC_BASIC', 'AML', 'AML_ONGOING'])
  })

  it('preserves line-item ordering: KYC_BASIC, AML, DHA, AML_ONGOING', () => {
    const result = estimateDiditCost({
      workflowProfile: 'KYC_AUTHORITATIVE',
      includeDha: true,
      includeAmlOngoing: true,
    })
    expect(result.lineItems.map(item => item.key)).toEqual(['KYC_BASIC', 'AML', 'DHA', 'AML_ONGOING'])
  })
})

describe('applyOverrides', () => {
  it('returns the original table when overrides are undefined', () => {
    expect(applyOverrides(DIDIT_PRICING, undefined)).toEqual(DIDIT_PRICING)
  })

  it('lets finance swap individual prices without losing defaults (e.g. DHA contract differs)', () => {
    const table = applyOverrides(DIDIT_PRICING, { dhaCentsUsd: 250 })
    expect(table.dhaCentsUsd).toBe(250)
    expect(table.kycBasicCentsUsd).toBe(DIDIT_PRICING.kycBasicCentsUsd)
    expect(table.amlCentsUsd).toBe(DIDIT_PRICING.amlCentsUsd)
  })

  it('honours overrides inside estimateDiditCost', () => {
    const result = estimateDiditCost({
      workflowProfile: 'KYC_AUTHORITATIVE',
      overrides: { dhaCentsUsd: 250 },
    })
    expect(result.centsUsd).toBe(33 + 20 + 250)
    expect(result.lineItems.find(item => item.key === 'DHA')?.centsUsd).toBe(250)
  })
})

describe('centsToDollars', () => {
  it('formats to two decimal places', () => {
    expect(centsToDollars(53)).toBe(0.53)
    expect(centsToDollars(348)).toBe(3.48)
    expect(centsToDollars(7)).toBe(0.07)
    expect(centsToDollars(0)).toBe(0)
  })
})
