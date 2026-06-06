import { describe, expect, it } from 'vitest'
import { maskIdNumber, lastFour } from '@/lib/provider-registration/id-masking'
import {
  hashRegistrationResumeToken,
  verifyRegistrationResumeToken,
} from '@/lib/provider-registration/tokens'
import { resolveProviderRegistrationDestination } from '@/lib/provider-registration/resolver'

describe('provider registration foundation helpers', () => {
  it('masks identity numbers while preserving only the last four digits', () => {
    expect(maskIdNumber('8001015009087')).toBe('*********9087')
    expect(lastFour('8001015009087')).toBe('9087')
  })

  it('hashes resume tokens without storing the raw token', async () => {
    const hash = await hashRegistrationResumeToken('raw-token')

    expect(hash).not.toContain('raw-token')
    expect(await verifyRegistrationResumeToken('raw-token', hash)).toBe(true)
    expect(await verifyRegistrationResumeToken('wrong-token', hash)).toBe(false)
  })

  it('routes active drafts to the dedicated draft return state', () => {
    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'NONE',
      hasActiveDraft: true,
      lastCompletedStep: 4,
    })).toEqual({ route: '/provider/register/draft', state: 'draft' })
  })

  it('prioritises submitted application states over draft progress', () => {
    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'MORE_INFO_REQUIRED',
      hasActiveDraft: true,
      lastCompletedStep: 4,
    })).toEqual({ route: '/provider/register/status', state: 'more_info' })
  })

  it('routes approved applications to the approved return state so credit gating is visible', () => {
    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'APPROVED',
      hasActiveDraft: true,
      lastCompletedStep: 4,
    })).toEqual({ route: '/provider/register/status', state: 'approved' })

    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'NONE',
      providerStatus: 'ACTIVE',
    })).toEqual({ route: '/provider' })
  })

  it('routes submitted pending and rejected applications to registration status', () => {
    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'PENDING',
    })).toEqual({ route: '/provider/register/status', state: 'pending' })

    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'REJECTED',
    })).toEqual({ route: '/provider/register/status', state: 'rejected' })

    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'CANCELLED',
    })).toEqual({ route: '/provider/register/status', state: 'cancelled' })
  })
})
