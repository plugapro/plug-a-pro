import { describe, expect, it } from 'vitest'
import {
  calculateProviderEconomics,
  type ProviderEconomicsInput,
} from '../../../lib/commercial/provider-economics'

const sharedPillars = {
  activeProviderCount: 100,
  newProvidersPerMonth: 25,
  monthlyFixedStackCostUsd: 200,
  monthlyVariableCostPerProviderUsd: 0.5,
  recurringVerificationCostPerProviderUsd: 0.1,
  leadFeeUsd: 5,
  variableCostPerLeadUsd: 0.5,
  paidLeadConversionRate: 0.5,
}

const smileIdInput: ProviderEconomicsInput = {
  ...sharedPillars,
  onboardingVerificationModel: 'minimum_kyc' as const,
  smileSecureApplies: false,
}

const diditInput: ProviderEconomicsInput = {
  ...sharedPillars,
  onboardingVerificationModel: 'minimum_kyc' as const,  // ignored when scenario is DIDIT
  smileSecureApplies: false,
  onboardingVendorScenario: 'DIDIT',
  diditWorkflowProfile: 'KYC_AUTHORITATIVE',
}

describe('calculateProviderEconomics - Didit scenario', () => {
  it('switches onboarding cost source from SmileID checks to Didit pricing', () => {
    const smile = calculateProviderEconomics(smileIdInput)
    const didit = calculateProviderEconomics(diditInput)
    expect(smile.onboardingVendorScenario).toBe('SMILE_ID')
    expect(didit.onboardingVendorScenario).toBe('DIDIT')
    expect(smile.directOnboardingCostPerProviderUsd).not.toBe(didit.directOnboardingCostPerProviderUsd)
  })

  it('Didit authoritative + DHA returns $3.48 per provider (33 + 20 + 295 cents)', () => {
    const result = calculateProviderEconomics(diditInput)
    expect(result.directOnboardingCostPerProviderUsd).toBe(3.48)
    expect(result.onboardingLineItems.map(item => item.key)).toEqual([
      'DIDIT_KYC_BASIC',
      'DIDIT_AML',
      'DIDIT_DHA',
    ])
  })

  it('Didit basic workflow returns $0.53 per provider with no DHA', () => {
    const result = calculateProviderEconomics({
      ...diditInput,
      diditWorkflowProfile: 'KYC_BASIC',
    })
    expect(result.directOnboardingCostPerProviderUsd).toBe(0.53)
    expect(result.onboardingLineItems.map(item => item.key)).toEqual([
      'DIDIT_KYC_BASIC',
      'DIDIT_AML',
    ])
  })

  it('keeps the four cost pillars intact across both scenarios (lead break-even comparable)', () => {
    const smile = calculateProviderEconomics(smileIdInput)
    const didit = calculateProviderEconomics(diditInput)
    expect(smile.monthlyProviderVariableCostUsd).toBe(didit.monthlyProviderVariableCostUsd)
    expect(smile.monthlyRecurringVerificationCostUsd).toBe(didit.monthlyRecurringVerificationCostUsd)
    expect(smile.contributionMarginPerProcessedLeadUsd).toBe(didit.contributionMarginPerProcessedLeadUsd)
    expect(Number.isFinite(smile.monthlyTotalTechCostUsd)).toBe(true)
    expect(Number.isFinite(didit.monthlyTotalTechCostUsd)).toBe(true)
    // Break-even leads per provider should be derivable and finite for both
    // scenarios when contribution margin is positive.
    expect(smile.leadsRequiredToRecoverOneProviderOnboarding).toBeGreaterThan(0)
    expect(didit.leadsRequiredToRecoverOneProviderOnboarding).toBeGreaterThan(0)
  })

  it('ignores smileSecureApplies in the Didit scenario', () => {
    const result = calculateProviderEconomics({
      ...diditInput,
      smileSecureApplies: true,  // would add $500 in SmileID scenario
    })
    expect(result.smileSecureMonthlyCostUsd).toBe(0)
  })

  it('Didit + ongoing AML adds $0.07/user/year to the per-provider onboarding cost line', () => {
    const result = calculateProviderEconomics({
      ...diditInput,
      diditWorkflowProfile: 'KYC_BASIC',
      diditIncludeAmlOngoing: true,
    })
    expect(result.directOnboardingCostPerProviderUsd).toBe(0.6)
    const ongoing = result.onboardingLineItems.find(item => item.key === 'DIDIT_AML_ONGOING')
    expect(ongoing?.priceUsd).toBe(0.07)
  })
})
