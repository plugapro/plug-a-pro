import { describe, expect, it } from 'vitest'
import {
  INTERNAL_TEST_COHORT_NAME,
  INTERNAL_TEST_PHONE_NUMBERS,
  createTestCohortContext,
  isInternalTestPhone,
} from '@/lib/internal-test-cohort'

describe('internal test cohort', () => {
  it('detects all internal staff numbers across local and international formats', () => {
    const cases = [
      ['0823035070', '+27823035070'],
      ['27823035070', '+27823035070'],
      ['+27823035070', '+27823035070'],
      ['0773923802', '+27773923802'],
      ['27773923802', '+27773923802'],
      ['+27773923802', '+27773923802'],
      ['0764010810', '+27764010810'],
      ['27764010810', '+27764010810'],
      ['+27764010810', '+27764010810'],
      ['0832114183', '+27832114183'],
      ['27832114183', '+27832114183'],
      ['+27832114183', '+27832114183'],
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
      '+27823035070',
      '+27773923802',
      '+27764010810',
      '+27832114183',
    ])
    expect(isInternalTestPhone('+27821234567')).toBe(false)
    expect(createTestCohortContext('0821234567')).toEqual({
      isTestUser: false,
      cohortName: null,
      normalizedPhone: '+27821234567',
    })
  })
})
