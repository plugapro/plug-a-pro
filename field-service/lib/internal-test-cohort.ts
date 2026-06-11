import { normalizePhone } from './utils'

export const INTERNAL_TEST_COHORT_NAME = 'internal_staff_test'

// SECURITY (finding ca4b71d2): the internal staff phone numbers are real PII and
// MUST NOT be committed to source. They are supplied at runtime via environment
// variables (set in Vercel for production, and in vitest.config.ts as synthetic
// reserved-style numbers for tests). The module reads the env at import time, so
// the env vars must be present at process LAUNCH (see vitest.config.ts comment).
//
// Bootstrap list - seeds Customer.isTestUser / Provider.isTestUser when those
// rows are first created. The DB flags are authoritative once a row exists;
// adding/removing test users at runtime should be done by flipping the DB flag,
// not by editing the env var. We still consult the list as a fallback for
// recipients whose DB row hasn't been loaded into the cohort context yet.
function parseE164List(raw: string | undefined): readonly string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizePhone(entry))
}

export const INTERNAL_TEST_PHONE_NUMBERS: readonly string[] = parseE164List(
  process.env.INTERNAL_TEST_PHONE_NUMBERS,
)

export const INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS: readonly string[] =
  parseE164List(process.env.INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS)

export const INTERNAL_TEST_ONBOARDING_CREDITS = 10

const INTERNAL_TEST_PHONE_SET = new Set<string>(INTERNAL_TEST_PHONE_NUMBERS)
const INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_SET = new Set<string>(
  INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS,
)

export type TestCohortContext = {
  isTestUser: boolean
  cohortName: typeof INTERNAL_TEST_COHORT_NAME | null
  normalizedPhone: string
}

export function isInternalTestPhone(phoneNumber: string | null | undefined): boolean {
  if (!phoneNumber) return false
  return INTERNAL_TEST_PHONE_SET.has(normalizePhone(phoneNumber))
}

export function isInternalTestOnboardingCreditPhone(
  phoneNumber: string | null | undefined,
): boolean {
  if (!phoneNumber) return false
  return INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_SET.has(normalizePhone(phoneNumber))
}

export function createTestCohortContext(phoneNumber: string | null | undefined): TestCohortContext {
  const normalizedPhone = normalizePhone(phoneNumber ?? '')
  const isTestUser = isInternalTestPhone(normalizedPhone)
  return {
    isTestUser,
    cohortName: isTestUser ? INTERNAL_TEST_COHORT_NAME : null,
    normalizedPhone,
  }
}

export function cohortFieldsForPhone(phoneNumber: string | null | undefined) {
  const cohort = createTestCohortContext(phoneNumber)
  return {
    isTestUser: cohort.isTestUser,
    cohortName: cohort.cohortName,
  }
}

export function testRequestFields(isTestRequest: boolean) {
  return {
    isTestRequest,
    cohortName: isTestRequest ? INTERNAL_TEST_COHORT_NAME : null,
  }
}

export function testLeadFields(isTestLead: boolean) {
  return {
    isTestLead,
    cohortName: isTestLead ? INTERNAL_TEST_COHORT_NAME : null,
  }
}

export function testEventFields(isTestEvent: boolean) {
  return {
    isTestEvent,
    cohortName: isTestEvent ? INTERNAL_TEST_COHORT_NAME : null,
  }
}

export function testTransactionFields(isTestTransaction: boolean) {
  return {
    isTestTransaction,
    cohortName: isTestTransaction ? INTERNAL_TEST_COHORT_NAME : null,
  }
}

export function isCohortMismatch(params: {
  subjectIsTest: boolean
  recipientPhone: string
  recipientIsTest?: boolean
  allowTestOverride?: boolean
}) {
  if (params.allowTestOverride) return false
  // Prefer the caller-supplied flag (sourced from Customer.isTestUser /
  // Provider.isTestUser in the DB). Fall back to the bootstrap phone list only
  // when the caller hasn't loaded the DB row.
  const recipientIsTest =
    typeof params.recipientIsTest === 'boolean'
      ? params.recipientIsTest
      : isInternalTestPhone(params.recipientPhone)
  return params.subjectIsTest !== recipientIsTest
}
