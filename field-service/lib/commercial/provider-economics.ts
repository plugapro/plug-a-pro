import { estimateDiditCost, type DiditWorkflowProfile } from './didit-pricing'
import {
  CONSERVATIVE_FULL_STACK_WARNING,
  ONBOARDING_VERIFICATION_MODELS,
  SMILE_ID_CHECKS,
  SMILE_SECURE_MONTHLY_SUBSCRIPTION_USD,
  type OnboardingVerificationModel,
  type SmileIdCheck,
  type SmileIdCheckKey,
} from './smileid-pricing'

export type OnboardingVendorScenario = 'SMILE_ID' | 'DIDIT'

export type ProviderEconomicsInput = {
  activeProviderCount: number
  newProvidersPerMonth: number
  // SmileID-specific inputs (used when onboardingVendorScenario !== 'DIDIT').
  onboardingVerificationModel: OnboardingVerificationModel
  smileSecureApplies: boolean
  customCheckSelection?: SmileIdCheckKey[]
  // Didit-specific inputs (used when onboardingVendorScenario === 'DIDIT').
  onboardingVendorScenario?: OnboardingVendorScenario
  diditWorkflowProfile?: DiditWorkflowProfile
  diditIncludeDha?: boolean
  diditIncludeAmlOngoing?: boolean
  // Shared cost pillars.
  monthlyFixedStackCostUsd: number
  monthlyVariableCostPerProviderUsd: number
  recurringVerificationCostPerProviderUsd: number
  leadFeeUsd: number
  variableCostPerLeadUsd: number
  paidLeadConversionRate: number
  exchangeRateZarPerUsd?: number
}

export type OnboardingLineItem = { key: string; label: string; priceUsd: number }

export type ProviderEconomicsResult = {
  onboardingVendorScenario: OnboardingVendorScenario
  selectedChecks: SmileIdCheck[]
  onboardingLineItems: OnboardingLineItem[]
  warnings: string[]
  directOnboardingCostPerProviderUsd: number
  monthlyNewProviderOnboardingCostUsd: number
  smileSecureMonthlyCostUsd: number
  monthlyProviderVariableCostUsd: number
  monthlyRecurringVerificationCostUsd: number
  monthlyUpkeepCostUsd: number
  monthlyTotalTechCostUsd: number
  upkeepCostPerActiveProviderUsd: number
  firstMonthFullyLoadedCostPerNewProviderUsd: number
  contributionMarginPerProcessedLeadUsd: number
  leadsRequiredToRecoverMonthlyTechCost: number | null
  leadsRequiredToRecoverOneProviderOnboarding: number | null
  zar?: ProviderEconomicsZarResult
}

export type ProviderEconomicsZarResult = {
  directOnboardingCostPerProviderZar: number
  monthlyNewProviderOnboardingCostZar: number
  smileSecureMonthlyCostZar: number
  monthlyProviderVariableCostZar: number
  monthlyRecurringVerificationCostZar: number
  monthlyUpkeepCostZar: number
  monthlyTotalTechCostZar: number
  upkeepCostPerActiveProviderZar: number
  firstMonthFullyLoadedCostPerNewProviderZar: number
  contributionMarginPerProcessedLeadZar: number
}

export class ProviderEconomicsValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '))
    this.name = 'ProviderEconomicsValidationError'
  }
}

export function calculateProviderEconomics(input: ProviderEconomicsInput): ProviderEconomicsResult {
  const validationErrors = validateProviderEconomicsInput(input)
  if (validationErrors.length > 0) {
    throw new ProviderEconomicsValidationError(validationErrors)
  }

  const scenario: OnboardingVendorScenario = input.onboardingVendorScenario ?? 'SMILE_ID'
  const { selectedChecks, onboardingLineItems, directOnboardingCostPerProviderUsd, warnings } =
    scenario === 'DIDIT'
      ? resolveDiditOnboarding(input)
      : resolveSmileIdOnboarding(input)

  const monthlyNewProviderOnboardingCostUsd = money(input.newProvidersPerMonth * directOnboardingCostPerProviderUsd)
  // SmileSecure is a SmileID-specific monthly subscription; it does not apply
  // to the Didit scenario.
  const smileSecureMonthlyCostUsd = scenario === 'SMILE_ID' && input.smileSecureApplies ? SMILE_SECURE_MONTHLY_SUBSCRIPTION_USD : 0
  const monthlyProviderVariableCostUsd = money(input.activeProviderCount * input.monthlyVariableCostPerProviderUsd)
  const monthlyRecurringVerificationCostUsd = money(input.activeProviderCount * input.recurringVerificationCostPerProviderUsd)
  const monthlyUpkeepCostUsd = money(
    input.monthlyFixedStackCostUsd +
    smileSecureMonthlyCostUsd +
    monthlyProviderVariableCostUsd +
    monthlyRecurringVerificationCostUsd,
  )
  const monthlyTotalTechCostUsd = money(monthlyUpkeepCostUsd + monthlyNewProviderOnboardingCostUsd)
  const upkeepCostPerActiveProviderUsd = input.activeProviderCount > 0
    ? money(monthlyUpkeepCostUsd / input.activeProviderCount)
    : 0
  const firstMonthFullyLoadedCostPerNewProviderUsd = money(
    directOnboardingCostPerProviderUsd + upkeepCostPerActiveProviderUsd,
  )
  const contributionMarginPerProcessedLeadUsd = money(
    (input.leadFeeUsd * input.paidLeadConversionRate) - input.variableCostPerLeadUsd,
  )
  const leadsRequiredToRecoverMonthlyTechCost = contributionMarginPerProcessedLeadUsd > 0
    ? Math.ceil(monthlyTotalTechCostUsd / contributionMarginPerProcessedLeadUsd)
    : null
  const leadsRequiredToRecoverOneProviderOnboarding = contributionMarginPerProcessedLeadUsd > 0
    ? Math.ceil(firstMonthFullyLoadedCostPerNewProviderUsd / contributionMarginPerProcessedLeadUsd)
    : null

  return {
    onboardingVendorScenario: scenario,
    selectedChecks,
    onboardingLineItems,
    warnings,
    directOnboardingCostPerProviderUsd,
    monthlyNewProviderOnboardingCostUsd,
    smileSecureMonthlyCostUsd,
    monthlyProviderVariableCostUsd,
    monthlyRecurringVerificationCostUsd,
    monthlyUpkeepCostUsd,
    monthlyTotalTechCostUsd,
    upkeepCostPerActiveProviderUsd,
    firstMonthFullyLoadedCostPerNewProviderUsd,
    contributionMarginPerProcessedLeadUsd,
    leadsRequiredToRecoverMonthlyTechCost,
    leadsRequiredToRecoverOneProviderOnboarding,
    ...(input.exchangeRateZarPerUsd ? {
      zar: buildZarResult({
        exchangeRateZarPerUsd: input.exchangeRateZarPerUsd,
        directOnboardingCostPerProviderUsd,
        monthlyNewProviderOnboardingCostUsd,
        smileSecureMonthlyCostUsd,
        monthlyProviderVariableCostUsd,
        monthlyRecurringVerificationCostUsd,
        monthlyUpkeepCostUsd,
        monthlyTotalTechCostUsd,
        upkeepCostPerActiveProviderUsd,
        firstMonthFullyLoadedCostPerNewProviderUsd,
        contributionMarginPerProcessedLeadUsd,
      }),
    } : {}),
  }
}

export function validateProviderEconomicsInput(input: ProviderEconomicsInput): string[] {
  const errors: string[] = []
  if (input.activeProviderCount < 0) errors.push('activeProviderCount must be greater than or equal to 0')
  if (input.newProvidersPerMonth < 0) errors.push('newProvidersPerMonth must be greater than or equal to 0')
  if (input.monthlyFixedStackCostUsd < 0) errors.push('monthlyFixedStackCostUsd must be greater than or equal to 0')
  if (input.monthlyVariableCostPerProviderUsd < 0) errors.push('monthlyVariableCostPerProviderUsd must be greater than or equal to 0')
  if (input.recurringVerificationCostPerProviderUsd < 0) errors.push('recurringVerificationCostPerProviderUsd must be greater than or equal to 0')
  if (input.leadFeeUsd < 0) errors.push('leadFeeUsd must be greater than or equal to 0')
  if (input.variableCostPerLeadUsd < 0) errors.push('variableCostPerLeadUsd must be greater than or equal to 0')
  if (input.paidLeadConversionRate < 0 || input.paidLeadConversionRate > 1) {
    errors.push('paidLeadConversionRate must be between 0 and 1')
  }
  if (input.exchangeRateZarPerUsd !== undefined && input.exchangeRateZarPerUsd <= 0) {
    errors.push('exchangeRateZarPerUsd must be greater than 0 when provided')
  }
  if (input.onboardingVerificationModel === 'custom' && !input.customCheckSelection) {
    errors.push('customCheckSelection is required when onboardingVerificationModel is custom')
  }
  return errors
}

function resolveSmileIdOnboarding(input: ProviderEconomicsInput) {
  const checkKeys = input.onboardingVerificationModel === 'custom'
    ? input.customCheckSelection ?? []
    : ONBOARDING_VERIFICATION_MODELS[input.onboardingVerificationModel].checks
  const selectedChecks = checkKeys.map((key) => SMILE_ID_CHECKS[key])
  const onboardingLineItems: OnboardingLineItem[] = selectedChecks.map(check => ({
    key: check.key,
    label: check.label,
    priceUsd: check.priceUsd,
  }))
  const directOnboardingCostPerProviderUsd = money(
    selectedChecks.reduce((sum, check) => sum + check.priceUsd, 0),
  )
  const warnings = input.onboardingVerificationModel === 'conservative_full_stack'
    ? [CONSERVATIVE_FULL_STACK_WARNING]
    : []
  return { selectedChecks, onboardingLineItems, directOnboardingCostPerProviderUsd, warnings }
}

function resolveDiditOnboarding(input: ProviderEconomicsInput) {
  const profile: DiditWorkflowProfile = input.diditWorkflowProfile ?? 'KYC_AUTHORITATIVE'
  const cost = estimateDiditCost({
    workflowProfile: profile,
    includeDha: input.diditIncludeDha,
    includeAmlOngoing: input.diditIncludeAmlOngoing,
  })
  const onboardingLineItems: OnboardingLineItem[] = cost.lineItems.map(item => ({
    key: `DIDIT_${item.key}`,
    label: item.label,
    priceUsd: item.centsUsd / 100,
  }))
  return {
    selectedChecks: [] as SmileIdCheck[],
    onboardingLineItems,
    directOnboardingCostPerProviderUsd: money(cost.centsUsd / 100),
    warnings: [] as string[],
  }
}

function buildZarResult(input: Omit<ProviderEconomicsResult, 'onboardingVendorScenario' | 'selectedChecks' | 'onboardingLineItems' | 'warnings' | 'zar' | 'leadsRequiredToRecoverMonthlyTechCost' | 'leadsRequiredToRecoverOneProviderOnboarding'> & {
  exchangeRateZarPerUsd: number
}): ProviderEconomicsZarResult {
  return {
    directOnboardingCostPerProviderZar: money(input.directOnboardingCostPerProviderUsd * input.exchangeRateZarPerUsd),
    monthlyNewProviderOnboardingCostZar: money(input.monthlyNewProviderOnboardingCostUsd * input.exchangeRateZarPerUsd),
    smileSecureMonthlyCostZar: money(input.smileSecureMonthlyCostUsd * input.exchangeRateZarPerUsd),
    monthlyProviderVariableCostZar: money(input.monthlyProviderVariableCostUsd * input.exchangeRateZarPerUsd),
    monthlyRecurringVerificationCostZar: money(input.monthlyRecurringVerificationCostUsd * input.exchangeRateZarPerUsd),
    monthlyUpkeepCostZar: money(input.monthlyUpkeepCostUsd * input.exchangeRateZarPerUsd),
    monthlyTotalTechCostZar: money(input.monthlyTotalTechCostUsd * input.exchangeRateZarPerUsd),
    upkeepCostPerActiveProviderZar: money(input.upkeepCostPerActiveProviderUsd * input.exchangeRateZarPerUsd),
    firstMonthFullyLoadedCostPerNewProviderZar: money(input.firstMonthFullyLoadedCostPerNewProviderUsd * input.exchangeRateZarPerUsd),
    contributionMarginPerProcessedLeadZar: money(input.contributionMarginPerProcessedLeadUsd * input.exchangeRateZarPerUsd),
  }
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
