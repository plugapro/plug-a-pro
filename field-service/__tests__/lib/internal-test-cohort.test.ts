import { afterEach, describe, expect, it, vi } from 'vitest'

// The internal-test-cohort module reads its phone lists from environment
// variables AT IMPORT TIME (finding ca4b71d2 — no PII hard-coded in source). We
// therefore stub the env with RESERVED/FAKE numbers and re-import the module
// fresh inside each test so it picks up the stubbed values.
// Reserved/fake numbers in the SA 071 000 000x test block — they normalise
// cleanly through normalizePhone (local 0-prefix and bare-27 forms) and are not
// real subscriber numbers.
const TEST_PHONE_ENV = '+27710000001,+27710000002,+27710000003'
const TEST_CREDIT_PHONE_ENV = '+27710000002'

type CohortModule = typeof import('@/lib/internal-test-cohort')

async function loadCohortModule(): Promise<CohortModule> {
  vi.resetModules()
  vi.stubEnv('INTERNAL_TEST_PHONE_NUMBERS', TEST_PHONE_ENV)
  vi.stubEnv('INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS', TEST_CREDIT_PHONE_ENV)
  return import('@/lib/internal-test-cohort')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('internal test cohort', () => {
  it('detects configured staff numbers across local and international formats', async () => {
    const mod = await loadCohortModule()
    const cases = [
      ['0710000001', '+27710000001'],
      ['27710000001', '+27710000001'],
      ['+27710000001', '+27710000001'],
      ['0710000002', '+27710000002'],
      ['27710000002', '+27710000002'],
      ['+27710000002', '+27710000002'],
      ['0710000003', '+27710000003'],
      ['27710000003', '+27710000003'],
      ['+27710000003', '+27710000003'],
    ] as const

    for (const [input, normalized] of cases) {
      expect(mod.isInternalTestPhone(input)).toBe(true)
      expect(mod.createTestCohortContext(input)).toEqual({
        isTestUser: true,
        cohortName: mod.INTERNAL_TEST_COHORT_NAME,
        normalizedPhone: normalized,
      })
    }
  })

  it('reads the bootstrap list from the environment, not hard-coded source', async () => {
    const mod = await loadCohortModule()
    expect([...mod.INTERNAL_TEST_PHONE_NUMBERS]).toEqual([
      '+27710000001',
      '+27710000002',
      '+27710000003',
    ])
    expect(mod.isInternalTestPhone('+27821234567')).toBe(false)
    expect(mod.createTestCohortContext('0821234567')).toEqual({
      isTestUser: false,
      cohortName: null,
      normalizedPhone: '+27821234567',
    })
  })

  it('detects the staff numbers that receive 10 onboarding test credits', async () => {
    const mod = await loadCohortModule()
    expect([...mod.INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS]).toEqual([
      '+27710000002',
    ])
    expect(mod.INTERNAL_TEST_ONBOARDING_CREDITS).toBe(10)

    for (const input of ['0710000002', '27710000002', '+27710000002']) {
      expect(mod.isInternalTestOnboardingCreditPhone(input)).toBe(true)
    }

    expect(mod.isInternalTestOnboardingCreditPhone('0710000001')).toBe(false)
    expect(mod.isInternalTestOnboardingCreditPhone('0710000003')).toBe(false)
    expect(mod.isInternalTestOnboardingCreditPhone('+27821234567')).toBe(false)
  })

  it('returns an empty cohort when no env list is configured', async () => {
    vi.resetModules()
    vi.stubEnv('INTERNAL_TEST_PHONE_NUMBERS', '')
    vi.stubEnv('INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS', '')
    const empty = await import('@/lib/internal-test-cohort')
    expect([...empty.INTERNAL_TEST_PHONE_NUMBERS]).toEqual([])
    expect(empty.isInternalTestPhone('+27000000001')).toBe(false)
  })
})
