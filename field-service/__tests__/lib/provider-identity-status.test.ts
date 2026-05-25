import { describe, expect, it } from 'vitest'

import {
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
})
