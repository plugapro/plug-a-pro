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
  it('detects all internal staff numbers across local and international formats', () => {
    const cases = [
      ['0773923802', '+27773923802'],
      ['27773923802', '+27773923802'],
      ['+27773923802', '+27773923802'],
      ['0764010810', '+27764010810'],
      ['27764010810', '+27764010810'],
      ['+27764010810', '+27764010810'],
      ['0832114183', '+27832114183'],
      ['27832114183', '+27832114183'],
      ['+27832114183', '+27832114183'],
      ['0824978565', '+27824978565'],
      ['27824978565', '+27824978565'],
      ['+27824978565', '+27824978565'],
      ['0827006695', '+27827006695'],
      ['27827006695', '+27827006695'],
      ['+27827006695', '+27827006695'],
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
      '+27773923802',
      '+27764010810',
      '+27823035070',
      '+27832114183',
      '+27824978565',
      '+27827006695',
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
      '+27764010810',
    ])
    expect(INTERNAL_TEST_ONBOARDING_CREDITS).toBe(10)

    for (const input of ['0764010810', '27764010810', '+27764010810']) {
      expect(isInternalTestOnboardingCreditPhone(input)).toBe(true)
    }

    expect(isInternalTestOnboardingCreditPhone('0773923802')).toBe(false)
    expect(isInternalTestOnboardingCreditPhone('0824978565')).toBe(false)
    expect(isInternalTestOnboardingCreditPhone('+27821234567')).toBe(false)
  })
})
