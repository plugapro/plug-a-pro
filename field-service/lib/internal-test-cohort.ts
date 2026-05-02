import { normalizePhone } from './utils'

export const INTERNAL_TEST_COHORT_NAME = 'internal_staff_test'

// Bootstrap list — seeds Customer.isTestUser / Provider.isTestUser when those
// rows are first created. The DB flags are authoritative once a row exists;
// adding/removing test users at runtime should be done by flipping the DB flag,
// not by editing this list. We still consult the list as a fallback for
// recipients whose DB row hasn't been loaded into the cohort context yet.
export const INTERNAL_TEST_PHONE_NUMBERS = [
  '+27773923802',
  '+27764010810',
  '+27823035070',
  '+27832114183',
  '+27824978565',
  '+27827006695',
] as const

export const INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS = [
  '+27764010810',
] as const

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
