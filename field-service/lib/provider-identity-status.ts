import type { KycStatus } from '@prisma/client'

export type ProviderStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export type ProviderIdentityVerificationStatus = {
  kycStatus: KycStatus | null
  label: string
  shortLabel: string
  description: string
  creditGateTitle: string
  creditGateDescription: string
  tone: ProviderStatusTone
  isIdentityVerified: boolean
}

export type ProviderCreditGateStatus = {
  title: string
  description: string
  tone: ProviderStatusTone
}

export function providerApplicationApprovalStatus(verified: boolean) {
  return verified
    ? {
        label: 'Application approved',
        shortLabel: 'Approved',
        description: 'Plug A Pro has reviewed this provider application.',
        tone: 'success' as const,
      }
    : {
        label: 'Application under review',
        shortLabel: 'Under review',
        description: 'Plug A Pro still needs to review this provider application.',
        tone: 'warning' as const,
      }
}

export function providerIdentityVerificationStatus(
  kycStatus: KycStatus | null | undefined,
): ProviderIdentityVerificationStatus {
  switch (kycStatus) {
    case 'VERIFIED':
      return {
        kycStatus,
        label: 'Identity verified',
        shortLabel: 'ID verified',
        description: 'This provider has completed identity verification.',
        creditGateTitle: 'ID verified',
        creditGateDescription: 'Credit top-ups are unlocked for this provider.',
        tone: 'success',
        isIdentityVerified: true,
      }
    case 'IN_PROGRESS':
    case 'SUBMITTED':
      return {
        kycStatus,
        label: 'Identity under review',
        shortLabel: 'ID in review',
        description: 'Identity verification has started and is waiting for review.',
        creditGateTitle: 'ID verification in review',
        creditGateDescription: 'We are reviewing your ID before credit top-ups unlock.',
        tone: 'info',
        isIdentityVerified: false,
      }
    case 'REJECTED':
      return {
        kycStatus,
        label: 'Identity retry needed',
        shortLabel: 'ID retry needed',
        description: 'Identity verification needs another submission.',
        creditGateTitle: 'ID verification retry needed',
        creditGateDescription: 'Submit your ID again to unlock credit top-ups.',
        tone: 'danger',
        isIdentityVerified: false,
      }
    case 'EXPIRED':
      return {
        kycStatus,
        label: 'Identity expired',
        shortLabel: 'ID expired',
        description: 'Identity verification has expired and must be renewed.',
        creditGateTitle: 'ID verification expired',
        creditGateDescription: 'Renew your ID verification to unlock credit top-ups.',
        tone: 'warning',
        isIdentityVerified: false,
      }
    case 'NOT_STARTED':
    default:
      return {
        kycStatus: kycStatus ?? 'NOT_STARTED',
        label: 'Identity not started',
        shortLabel: 'ID not started',
        description: 'Identity verification has not been completed yet.',
        creditGateTitle: 'ID verification needed',
        creditGateDescription: 'Verify your identity to unlock credit top-ups.',
        tone: 'warning',
        isIdentityVerified: false,
      }
  }
}

export function providerCreditGateStatus(
  identityStatus: ProviderIdentityVerificationStatus,
  creditPurchaseLocked: boolean,
): ProviderCreditGateStatus {
  if (!creditPurchaseLocked) {
    return {
      title: 'ID verified',
      description: 'Credit top-ups are unlocked for this provider.',
      tone: 'success',
    }
  }

  return {
    title: 'Top-ups are locked until your identity is verified.',
    description: 'We need to verify your profile before you can buy credits and accept paid job leads.',
    tone: identityStatus.tone,
  }
}
