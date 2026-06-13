import { PROVIDER_CREDIT_PRICE_CENTS } from '@/lib/provider-credit-pricing'

// Once-off KYC / ID-verification recovery fee, in ZAR cents.
// Pegged to exactly 1 credit (R50) so first-top-up recovery can deduct a
// whole credit with no fractional-rand handling in the integer wallet.
// Overridable via env so finance can tune without a redeploy.
const DEFAULT_KYC_FEE_CENTS = PROVIDER_CREDIT_PRICE_CENTS
const parsedKycFeeCents = Number(process.env.KYC_FEE_CENTS ?? DEFAULT_KYC_FEE_CENTS)
// A malformed override must not poison fee bookings (NaN would make every
// booking throw INVALID_AMOUNT and roll back admin approvals), and a
// non-whole-credit override must not strand debts: recovery settles in whole
// credits, so a fee that isn't a credit multiple would be skipped on every
// top-up forever (SKIPPED_LEGACY_AMOUNT).
export const KYC_FEE_CENTS =
  Number.isInteger(parsedKycFeeCents) &&
  parsedKycFeeCents > 0 &&
  parsedKycFeeCents % PROVIDER_CREDIT_PRICE_CENTS === 0
    ? parsedKycFeeCents
    : DEFAULT_KYC_FEE_CENTS

// Didit free tier: first 500 Full-KYC bundles/month (see lib/commercial/didit-pricing.ts).
// Display-only on the admin campaign page; reconciliation against the vendor
// invoice stays a manual monthly process for now.
export const VENDOR_MONTHLY_FREE_TIER_DEFAULT = 500

export function formatRandsFromCents(cents: number): string {
  const rands = cents / 100
  return Number.isInteger(rands) ? `R${rands}` : `R${rands.toFixed(2)}`
}

// Once-off fee per provider — provider-scoped key makes the accrual idempotent forever.
export function kycFeeAccruedKey(providerId: string): string {
  return `kyc-fee-accrued:${providerId}`
}

// Once-off fee per provider — provider-scoped key makes recovery idempotent forever.
export function kycFeeRecoveredKey(providerId: string): string {
  return `kyc-fee-recovered:${providerId}`
}

// Sponsorship-scoped keys so a revoke + re-grant (different campaign) can't collide.
export function kycFeeSponsoredKey(sponsorshipId: string): string {
  return `kyc-fee-sponsored:${sponsorshipId}`
}

export function kycFeeReversedKey(sponsorshipId: string): string {
  return `kyc-fee-reversed:${sponsorshipId}`
}
