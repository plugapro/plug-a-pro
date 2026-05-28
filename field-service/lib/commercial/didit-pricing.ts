// Didit identity-verification pricing.
// Source: https://didit.me/pricing (verified 2026-05-27).
//
// Values are expressed in CENTS USD to keep the math integer-clean —
// downstream callers convert to dollars / ZAR at display time.
//
// Finance can override any value at runtime via `applyOverrides` without
// a redeploy; in a follow-up we may persist the override map on
// `verification_vendor_configs.configJson` for the 'didit' row.
//
// Free-tier handling (first 500 Full-KYC bundles/month) is intentionally
// NOT modelled here. The pricing module always returns the headline rate;
// monthly reconciliation against the Didit invoice happens downstream.

export const KYC_BASIC_CENTS_USD = 33      // Full KYC bundle ($0.33)
export const AML_CENTS_USD = 20             // AML screening per check ($0.20)
export const DHA_CENTS_USD = 295            // SA DHA National ID validation ($2.95)
export const AML_ONGOING_PER_USER_YEAR_CENTS_USD = 7 // Ongoing AML ($0.07/user/year)

export type DiditPricingTable = {
  kycBasicCentsUsd: number
  amlCentsUsd: number
  dhaCentsUsd: number
  amlOngoingPerUserYearCentsUsd: number
}

export const DIDIT_PRICING: DiditPricingTable = {
  kycBasicCentsUsd: KYC_BASIC_CENTS_USD,
  amlCentsUsd: AML_CENTS_USD,
  dhaCentsUsd: DHA_CENTS_USD,
  amlOngoingPerUserYearCentsUsd: AML_ONGOING_PER_USER_YEAR_CENTS_USD,
}

export function applyOverrides(
  table: DiditPricingTable,
  overrides: Partial<DiditPricingTable> | undefined,
): DiditPricingTable {
  if (!overrides) return table
  return { ...table, ...overrides }
}

export type DiditWorkflowProfile = 'KYC_BASIC' | 'KYC_AUTHORITATIVE'

export type EstimateDiditCostInput = {
  workflowProfile: DiditWorkflowProfile
  // Authoritative implies DHA by default (SA-resident provider onboarding);
  // toggle off when authoritative is reused for a non-SA flow.
  includeDha?: boolean
  // Ongoing AML monitoring is treated as a separate per-user/year line item.
  includeAmlOngoing?: boolean
  overrides?: Partial<DiditPricingTable>
}

export type DiditCostLineItem = {
  key: 'KYC_BASIC' | 'AML' | 'DHA' | 'AML_ONGOING'
  label: string
  centsUsd: number
}

export type EstimateDiditCostResult = {
  centsUsd: number
  lineItems: DiditCostLineItem[]
}

/**
 * Headline-rate Didit cost estimate (cents USD).
 *
 * Verified test vectors (matches spec §6.6):
 *   - KYC_BASIC                     => $0.53  (33 + 20)
 *   - KYC_AUTHORITATIVE + DHA       => $3.48  (33 + 20 + 295)
 *   - + Ongoing AML                 => $3.55  (33 + 20 + 295 + 7)
 *   - Ongoing AML on its own        => $0.07
 *
 * Line-item order is stable: KYC_BASIC, AML, DHA, AML_ONGOING.
 */
export function estimateDiditCost(input: EstimateDiditCostInput): EstimateDiditCostResult {
  const table = applyOverrides(DIDIT_PRICING, input.overrides)
  const includeDha = input.includeDha ?? (input.workflowProfile === 'KYC_AUTHORITATIVE')
  const includeAmlOngoing = input.includeAmlOngoing ?? false

  const lineItems: DiditCostLineItem[] = [
    { key: 'KYC_BASIC', label: 'Didit Full KYC bundle', centsUsd: table.kycBasicCentsUsd },
    { key: 'AML', label: 'Didit AML screening', centsUsd: table.amlCentsUsd },
  ]
  if (includeDha) {
    lineItems.push({ key: 'DHA', label: 'SA DHA National ID validation', centsUsd: table.dhaCentsUsd })
  }
  if (includeAmlOngoing) {
    lineItems.push({
      key: 'AML_ONGOING',
      label: 'Ongoing AML monitoring (per user/year)',
      centsUsd: table.amlOngoingPerUserYearCentsUsd,
    })
  }

  const centsUsd = lineItems.reduce((sum, item) => sum + item.centsUsd, 0)
  return { centsUsd, lineItems }
}

export function centsToDollars(cents: number): number {
  return Math.round((cents / 100 + Number.EPSILON) * 100) / 100
}
