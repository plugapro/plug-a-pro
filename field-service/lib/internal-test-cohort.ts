import { normalizePhone } from './utils'

export const INTERNAL_TEST_COHORT_NAME = 'internal_staff_test'

export const INTERNAL_TEST_PHONE_NUMBERS = [
  '+27823035070',
  '+27773923802',
  '+27764010810',
  '+27832114183',
  '+27824978565',
  '+27827006695',
] as const

export const INTERNAL_TEST_ONBOARDING_CREDIT_PHONE_NUMBERS = [
  '+27823035070',
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
  allowTestOverride?: boolean
}) {
  if (params.allowTestOverride) return false
  const recipientIsTest = isInternalTestPhone(params.recipientPhone)
  return params.subjectIsTest !== recipientIsTest
}
