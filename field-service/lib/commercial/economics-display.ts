/**
 * Browser-safe display values for the Provider Economics calculator.
 *
 * SECURITY (54bc65eb): the calculator is a `'use client'` component, so anything
 * it imports ships in the public `_next/static` route chunk (served without the
 * route's server auth). This module therefore exposes ONLY the minimal display
 * values the calculator UI needs — model option labels and the per-check picker
 * rows (key / label / price). It deliberately omits the commercial-strategy
 * notes and the raw onboarding-model composition (which checks each model
 * bundles), which remain in the server-side `smileid-pricing` module and are
 * surfaced to the client only as props from the server page when needed.
 */

export const ECONOMICS_VERIFICATION_MODEL_OPTIONS = [
  { key: 'minimum_kyc', label: 'Minimum KYC' },
  { key: 'recommended', label: 'Recommended' },
  { key: 'conservative_full_stack', label: 'Conservative full stack' },
  { key: 'custom', label: 'Custom' },
] as const

export type EconomicsVerificationModel =
  (typeof ECONOMICS_VERIFICATION_MODEL_OPTIONS)[number]['key']

export const ECONOMICS_SMILE_ID_CHECK_OPTIONS = [
  {
    key: 'SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID',
    label: 'SA Enhanced Document Verification National_ID',
    priceUsd: 1.15,
  },
  {
    key: 'SA_BASIC_ENHANCED_KYC_NATIONAL_ID',
    label: 'SA Basic / Enhanced KYC National_ID',
    priceUsd: 1.05,
  },
  {
    key: 'DOCUMENT_VERIFICATION',
    label: 'Document Verification',
    priceUsd: 0.8,
  },
  {
    key: 'SA_BIOMETRIC_KYC_NATIONAL_ID',
    label: 'SA Biometric KYC National_ID',
    priceUsd: 1.3,
  },
  {
    key: 'SA_PHONE_VERIFICATION',
    label: 'SA phone verification',
    priceUsd: 0.25,
  },
  {
    key: 'AML',
    label: 'AML',
    priceUsd: 0.35,
  },
] as const

export type EconomicsSmileIdCheckKey =
  (typeof ECONOMICS_SMILE_ID_CHECK_OPTIONS)[number]['key']
