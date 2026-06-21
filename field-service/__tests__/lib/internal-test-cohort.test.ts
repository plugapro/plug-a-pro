import { describe, expect, it } from 'vitest'
import {
  INTERNAL_TEST_COHORT_NAME,
  INTERNAL_TEST_ONBOARDING_CREDITS,
  INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS,
  INTERNAL_TEST_PHONE_NUMBERS,
  createTestCohortContext,
  isInternalTestOnboardingCreditPhone,
  isInternalTestPhone,
} from '@/lib/internal-test-cohort'

describe('internal test cohort', () => {
  // SECURITY (finding ca4b71d2): the cohort is sourced from env at import time.
  // These SYNTHETIC reserved-style numbers mirror the values set in
  // vitest.config.ts (test.env.INTERNAL_TEST_PHONE_NUMBERS). No real staff
  // numbers appear in source. We exercise the bare `27...` and `+27...` E.164
  // forms; the SA-local `0`-prefixed form is not used here because the reserved
  // `+27 0000 000x` range collides with normalizePhone's `00` international
  // access-prefix rule (irrelevant for the real, non-zero staff numbers).
  it('detects all internal staff numbers across normalized E.164 formats', () => {
    const cases = [
      ['27000000001', '+27000000001'],
      ['+27000000001', '+27000000001'],
      ['27000000009', '+27000000009'],
      ['+27000000009', '+27000000009'],
      ['27000000003', '+27000000003'],
      ['+27000000003', '+27000000003'],
      ['27000000004', '+27000000004'],
      ['+27000000004', '+27000000004'],
      ['27000000005', '+27000000005'],
      ['+27000000005', '+27000000005'],
      ['27000000006', '+27000000006'],
      ['+27000000006', '+27000000006'],
    ] as const

    for (const [input, normalized] of cases) {
      expect(isInternalTestPhone(input)).toBe(true)
      expect(createTestCohortContext(input)).toEqual({
        isTestUser: true,
        cohortName: INTERNAL_TEST_COHORT_NAME,
        normalizedPhone: normalized,
      })
    }
  })

  it('keeps live numbers outside the internal staff cohort', () => {
    expect(INTERNAL_TEST_PHONE_NUMBERS).toEqual([
      '+27000000001',
      '+27000000002',
      '+27000000003',
      '+27000000004',
      '+27000000005',
      '+27000000006',
      '+27000000009',
    ])
    expect(isInternalTestPhone('+27821234567')).toBe(false)
    expect(createTestCohortContext('0821234567')).toEqual({
      isTestUser: false,
      cohortName: null,
      normalizedPhone: '+27821234567',
    })
  })

  it('detects the internal staff numbers that receive 10 onboarding test credits', () => {
    expect(INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS).toEqual([
      '+27000000009',
    ])
    expect(INTERNAL_TEST_ONBOARDING_CREDITS).toBe(10)

    for (const input of ['27000000009', '+27000000009']) {
      expect(isInternalTestOnboardingCreditPhone(input)).toBe(true)
    }

    expect(isInternalTestOnboardingCreditPhone('+27000000001')).toBe(false)
    expect(isInternalTestOnboardingCreditPhone('+27000000004')).toBe(false)
    expect(isInternalTestOnboardingCreditPhone('+27821234567')).toBe(false)
  })
})
