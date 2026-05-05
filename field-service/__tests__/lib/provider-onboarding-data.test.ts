import { describe, expect, it } from 'vitest'
import {
  ProviderOnboardingValidationError,
  formatRandAmountForProviderOnboarding,
  validateProviderOnboardingRates,
} from '../../lib/provider-onboarding-data'

describe('provider onboarding data validation', () => {
  it('accepts common Rand amount formats', () => {
    expect(validateProviderOnboardingRates({ callOutFeeText: '250' })).toMatchObject({
      callOutFee: 250,
    })
    expect(validateProviderOnboardingRates({ callOutFeeText: 'R350.50' })).toMatchObject({
      callOutFee: 350.5,
    })
  })

  it('rejects invalid fee text', () => {
    expect(() => validateProviderOnboardingRates({ callOutFeeText: 'about 300' })).toThrow(
      ProviderOnboardingValidationError,
    )
  })

  it('formats provider-facing Rand amounts', () => {
    expect(formatRandAmountForProviderOnboarding(250)).toBe('R250')
    expect(formatRandAmountForProviderOnboarding(250.5)).toBe('R250.50')
    expect(formatRandAmountForProviderOnboarding(null)).toBe('Not set')
  })
})
