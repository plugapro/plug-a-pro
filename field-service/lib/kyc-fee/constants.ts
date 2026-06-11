// Once-off KYC / ID-verification recovery fee, in ZAR cents.
// Overridable via env so finance can tune without a redeploy.
const DEFAULT_KYC_FEE_CENTS = 2000
const parsedKycFeeCents = Number(process.env.KYC_FEE_CENTS ?? DEFAULT_KYC_FEE_CENTS)
// A malformed override must not poison fee bookings (NaN would make every
// booking throw INVALID_AMOUNT and roll back admin approvals).
export const KYC_FEE_CENTS =
  Number.isInteger(parsedKycFeeCents) && parsedKycFeeCents > 0
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

// Sponsorship-scoped keys so a revoke + re-grant (different campaign) can't collide.
export function kycFeeSponsoredKey(sponsorshipId: string): string {
  return `kyc-fee-sponsored:${sponsorshipId}`
}

export function kycFeeReversedKey(sponsorshipId: string): string {
  return `kyc-fee-reversed:${sponsorshipId}`
}
