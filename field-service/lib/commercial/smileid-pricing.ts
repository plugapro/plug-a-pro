export const SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID = 1.15
export const SA_BASIC_ENHANCED_KYC_NATIONAL_ID = 1.05
export const DOCUMENT_VERIFICATION = 0.8
export const SA_BIOMETRIC_KYC_NATIONAL_ID = 1.3
export const SA_PHONE_VERIFICATION = 0.25
export const AML = 0.35
export const SMILE_SECURE_MONTHLY_SUBSCRIPTION = 500

export const SMILE_ID_CHECKS = {
  SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID: {
    key: 'SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID',
    label: 'SA Enhanced Document Verification National_ID',
    priceUsd: SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID,
  },
  SA_BASIC_ENHANCED_KYC_NATIONAL_ID: {
    key: 'SA_BASIC_ENHANCED_KYC_NATIONAL_ID',
    label: 'SA Basic / Enhanced KYC National_ID',
    priceUsd: SA_BASIC_ENHANCED_KYC_NATIONAL_ID,
  },
  DOCUMENT_VERIFICATION: {
    key: 'DOCUMENT_VERIFICATION',
    label: 'Document Verification',
    priceUsd: DOCUMENT_VERIFICATION,
  },
  SA_BIOMETRIC_KYC_NATIONAL_ID: {
    key: 'SA_BIOMETRIC_KYC_NATIONAL_ID',
    label: 'SA Biometric KYC National_ID',
    priceUsd: SA_BIOMETRIC_KYC_NATIONAL_ID,
  },
  SA_PHONE_VERIFICATION: {
    key: 'SA_PHONE_VERIFICATION',
    label: 'SA phone verification',
    priceUsd: SA_PHONE_VERIFICATION,
  },
  AML: {
    key: 'AML',
    label: 'AML',
    priceUsd: AML,
  },
} as const

export const SMILE_SECURE_MONTHLY_SUBSCRIPTION_USD = SMILE_SECURE_MONTHLY_SUBSCRIPTION

export type SmileIdCheckKey = keyof typeof SMILE_ID_CHECKS

export type SmileIdCheck = typeof SMILE_ID_CHECKS[SmileIdCheckKey]

export const ONBOARDING_VERIFICATION_MODELS = {
  minimum_kyc: {
    label: 'Minimum KYC',
    checks: [
      SMILE_ID_CHECKS.SA_BASIC_ENHANCED_KYC_NATIONAL_ID.key,
      SMILE_ID_CHECKS.SA_PHONE_VERIFICATION.key,
      SMILE_ID_CHECKS.AML.key,
    ],
  },
  recommended: {
    label: 'Recommended',
    checks: [
      SMILE_ID_CHECKS.SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID.key,
      SMILE_ID_CHECKS.SA_BIOMETRIC_KYC_NATIONAL_ID.key,
      SMILE_ID_CHECKS.SA_PHONE_VERIFICATION.key,
      SMILE_ID_CHECKS.AML.key,
    ],
  },
  conservative_full_stack: {
    label: 'Conservative full stack',
    checks: [
      SMILE_ID_CHECKS.SA_BASIC_ENHANCED_KYC_NATIONAL_ID.key,
      SMILE_ID_CHECKS.SA_ENHANCED_DOCUMENT_VERIFICATION_NATIONAL_ID.key,
      SMILE_ID_CHECKS.SA_BIOMETRIC_KYC_NATIONAL_ID.key,
      SMILE_ID_CHECKS.SA_PHONE_VERIFICATION.key,
      SMILE_ID_CHECKS.AML.key,
    ],
  },
  custom: {
    label: 'Custom',
    checks: [],
  },
} as const

export type OnboardingVerificationModel = keyof typeof ONBOARDING_VERIFICATION_MODELS

export const CONSERVATIVE_FULL_STACK_WARNING =
  'This model may double-count identity verification. Confirm with SmileID whether both KYC and Enhanced Document Verification are required for the same provider onboarding journey.'

export const SMILE_SECURE_COMMERCIAL_NOTE =
  'Smile Secure is modelled as a conditional fixed monthly cost of $500/month for 0–10,000 jobs. We still need SmileID confirmation on whether this applies to Smile Links / EVD usage. Until confirmed, keep this as a toggle rather than a mandatory cost.'
