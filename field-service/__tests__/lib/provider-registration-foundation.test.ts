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

  it('routes active drafts to the next incomplete registration step', () => {
    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'NONE',
      hasActiveDraft: true,
      lastCompletedStep: 4,
    })).toEqual({ route: '/provider/register/availability' })
  })

  it('prioritises submitted application states over draft progress', () => {
    expect(resolveProviderRegistrationDestination({
      applicationStatus: 'MORE_INFO_REQUIRED',
      hasActiveDraft: true,
      lastCompletedStep: 4,
    })).toEqual({ route: '/provider/register/status', state: 'more_info' })
  })
})
