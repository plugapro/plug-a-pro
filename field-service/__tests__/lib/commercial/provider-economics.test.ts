import { describe, expect, it } from 'vitest'
import {
  ProviderEconomicsValidationError,
  calculateProviderEconomics,
} from '../../../lib/commercial/provider-economics'
import { SMILE_ID_CHECKS } from '../../../lib/commercial/smileid-pricing'

const baseInput = {
  activeProviderCount: 100,
  newProvidersPerMonth: 10,
  onboardingVerificationModel: 'minimum_kyc' as const,
  smileSecureApplies: false,
  monthlyFixedStackCostUsd: 200,
  monthlyVariableCostPerProviderUsd: 0.5,
  recurringVerificationCostPerProviderUsd: 0.1,
  leadFeeUsd: 5,
  variableCostPerLeadUsd: 0.5,
  paidLeadConversionRate: 0.5,
}

describe('calculateProviderEconomics', () => {
  it('returns the expected direct onboarding costs for predefined SmileID models', () => {
    expect(calculateProviderEconomics({ ...baseInput, onboardingVerificationModel: 'minimum_kyc' }).directOnboardingCostPerProviderUsd).toBe(1.65)
    expect(calculateProviderEconomics({ ...baseInput, onboardingVerificationModel: 'recommended' }).directOnboardingCostPerProviderUsd).toBe(3.05)
    expect(calculateProviderEconomics({ ...baseInput, onboardingVerificationModel: 'conservative_full_stack' }).directOnboardingCostPerProviderUsd).toBe(4.1)
  })

  it('adds Smile Secure only when the assumption is enabled', () => {
    expect(calculateProviderEconomics({ ...baseInput, smileSecureApplies: false }).smileSecureMonthlyCostUsd).toBe(0)
    expect(calculateProviderEconomics({ ...baseInput, smileSecureApplies: true }).smileSecureMonthlyCostUsd).toBe(500)
  })

  it('keeps monthly upkeep separate from new-provider onboarding while total includes both', () => {
    const result = calculateProviderEconomics({
      ...baseInput,
      smileSecureApplies: true,
      onboardingVerificationModel: 'minimum_kyc',
    })

    expect(result.monthlyNewProviderOnboardingCostUsd).toBe(16.5)
    expect(result.monthlyUpkeepCostUsd).toBe(760)
    expect(result.monthlyTotalTechCostUsd).toBe(776.5)
    expect(result.upkeepCostPerActiveProviderUsd).toBe(7.6)
    expect(result.firstMonthFullyLoadedCostPerNewProviderUsd).toBe(9.25)
  })

  it('uses contribution margin instead of gross lead fee for break-even calculations', () => {
    const result = calculateProviderEconomics({
      ...baseInput,
      smileSecureApplies: true,
      onboardingVerificationModel: 'minimum_kyc',
    })

    expect(result.contributionMarginPerProcessedLeadUsd).toBe(2)
    expect(result.leadsRequiredToRecoverMonthlyTechCost).toBe(389)
    expect(result.leadsRequiredToRecoverOneProviderOnboarding).toBe(5)
  })

  it('handles zero active providers without divide-by-zero errors', () => {
    const result = calculateProviderEconomics({
      ...baseInput,
      activeProviderCount: 0,
      smileSecureApplies: true,
    })

    expect(result.monthlyUpkeepCostUsd).toBe(700)
    expect(result.upkeepCostPerActiveProviderUsd).toBe(0)
    expect(result.firstMonthFullyLoadedCostPerNewProviderUsd).toBe(1.65)
  })

  it('returns null break-even counts when lead contribution margin is zero or negative', () => {
    const result = calculateProviderEconomics({
      ...baseInput,
      leadFeeUsd: 1,
      paidLeadConversionRate: 0.5,
      variableCostPerLeadUsd: 0.5,
    })

    expect(result.contributionMarginPerProcessedLeadUsd).toBe(0)
    expect(result.leadsRequiredToRecoverMonthlyTechCost).toBeNull()
    expect(result.leadsRequiredToRecoverOneProviderOnboarding).toBeNull()
  })

  it('supports a custom SmileID check selection', () => {
    const result = calculateProviderEconomics({
      ...baseInput,
      onboardingVerificationModel: 'custom',
      customCheckSelection: [
        SMILE_ID_CHECKS.SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID.key,
        SMILE_ID_CHECKS.AML.key,
      ],
    })

    expect(result.directOnboardingCostPerProviderUsd).toBe(1.5)
    expect(result.selectedChecks.map((check) => check.key)).toEqual([
      'SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID',
      'AML',
    ])
  })

  it('only returns ZAR display values when an exchange rate is provided', () => {
    expect(calculateProviderEconomics(baseInput).zar).toBeUndefined()

    const result = calculateProviderEconomics({
      ...baseInput,
      exchangeRateZarPerUsd: 18,
    })

    expect(result.zar?.directOnboardingCostPerProviderZar).toBe(29.7)
    expect(result.zar?.monthlyTotalTechCostZar).toBe(4977)
  })

  it('warns when the conservative full-stack model may double-count identity verification', () => {
    const result = calculateProviderEconomics({
      ...baseInput,
      onboardingVerificationModel: 'conservative_full_stack',
    })

    expect(result.warnings).toContain(
      'This model may double-count identity verification. Confirm with SmileID whether both KYC and Enhanced Document Verification are required for the same provider onboarding journey.',
    )
  })

  it('rejects invalid assumptions with field-specific validation messages', () => {
    expect(() => calculateProviderEconomics({
      ...baseInput,
      activeProviderCount: -1,
    })).toThrow(ProviderEconomicsValidationError)

    expect(() => calculateProviderEconomics({
      ...baseInput,
      paidLeadConversionRate: 1.2,
    })).toThrow('paidLeadConversionRate must be between 0 and 1')

    expect(() => calculateProviderEconomics({
      ...baseInput,
      exchangeRateZarPerUsd: 0,
    })).toThrow('exchangeRateZarPerUsd must be greater than 0 when provided')

    expect(() => calculateProviderEconomics({
      ...baseInput,
      onboardingVerificationModel: 'custom',
    })).toThrow('customCheckSelection is required when onboardingVerificationModel is custom')
  })
})
