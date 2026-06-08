import { describe, expect, it } from 'vitest'

import {
  providerCreditGateStatus,
  providerApplicationApprovalStatus,
  providerIdentityVerificationStatus,
} from '@/lib/provider-identity-status'

describe('provider status display labels', () => {
  it('separates application approval from identity verification', () => {
    expect(providerApplicationApprovalStatus(true).label).toBe('Application approved')
    expect(providerIdentityVerificationStatus('NOT_STARTED').label).toBe('Identity not started')
    expect(providerIdentityVerificationStatus('NOT_STARTED').isIdentityVerified).toBe(false)
  })

  it('uses kycStatus as the identity verification source of truth', () => {
    expect(providerIdentityVerificationStatus('VERIFIED')).toMatchObject({
      label: 'Identity verified',
      isIdentityVerified: true,
    })
    expect(providerIdentityVerificationStatus('SUBMITTED')).toMatchObject({
      label: 'Identity under review',
      isIdentityVerified: false,
    })
  })

  it('does not claim credit top-ups are unlocked when high-assurance credit verification is still locked', () => {
    const identityStatus = providerIdentityVerificationStatus('VERIFIED')
    const creditGateStatus = providerCreditGateStatus(identityStatus, true)

	  expect(creditGateStatus).toMatchObject({
	    title: 'Top-ups are locked until your identity is verified.',
	    description: 'We need to verify your profile before you can buy credits and accept paid job leads.',
	    tone: 'success',
	  })
	  expect(creditGateStatus.description).not.toContain('unlocked')
	})

  it('uses unlocked credit copy only when the paid-credit gate is actually open', () => {
    const identityStatus = providerIdentityVerificationStatus('VERIFIED')

    expect(providerCreditGateStatus(identityStatus, false)).toMatchObject({
      title: 'ID verified',
      description: 'Credit top-ups are unlocked for this provider.',
      tone: 'success',
    })
  })
})
