import { normalizePhone } from './utils'

export const INTERNAL_TEST_COHORT_NAME = 'internal_staff_test'

// SECURITY (finding ca4b71d2): internal staff phone numbers are POPIA-regulated
// PII and must NOT be hard-coded in source/build artifacts. The bootstrap list is
// now sourced from environment variables (comma/whitespace separated, E.164):
//   INTERNAL_TEST_PHONE_NUMBERS="+27...,+27..."
//   INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS="+27..."
// The DB isTestUser flags remain authoritative once a row exists; this list is
// only a fallback for recipients whose DB row hasn't been loaded into the cohort
// context yet. Adding/removing test users at runtime should flip the DB flag.
function parsePhoneListEnv(raw: string | undefined): readonly string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const token of raw.split(/[\s,]+/)) {
    const normalized = normalizePhone(token)
    if (normalized) seen.add(normalized)
  }
  return Object.freeze([...seen])
}

export const INTERNAL_TEST_PHONE_NUMBERS: readonly string[] = parsePhoneListEnv(
  process.env.INTERNAL_TEST_PHONE_NUMBERS,
)

export const INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS: readonly string[] =
  parsePhoneListEnv(process.env.INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS)

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
