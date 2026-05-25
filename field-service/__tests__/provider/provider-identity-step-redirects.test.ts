import { describe, expect, it, vi } from 'vitest'
import { ProviderVerificationTokenError } from '../../lib/provider-verification-token'
import { IdentityVerificationTransitionError } from '../../lib/identity-verification/orchestrator'
import {
  documentStepRedirect,
  identifierStepRedirect,
  mapVerificationActionError,
  reviewStepRedirect,
  selfieStepRedirect,
} from '../../app/provider/verify/[token]/step-redirects'

describe('provider identity verification step redirects', () => {
  it('routes a missing document to a controlled prompt, not the error boundary', () => {
    expect(
      documentStepRedirect('tok', { ok: false, code: 'MISSING_DOCUMENTS', missingDocuments: ['ID_FRONT'] }),
    ).toBe('/provider/verify/tok?missing=document')
  })

  it('routes a completed document step back into the flow', () => {
    expect(documentStepRedirect('tok', { ok: true })).toBe('/provider/verify/tok')
  })

  it('routes invalid document requirements to a recoverable in-flow prompt', () => {
    const url = documentStepRedirect('tok', { ok: false, code: 'INVALID_IDENTITY_BASIS' })
    expect(url.startsWith('/provider/verify/tok?upload_error=')).toBe(true)
    expect(url).toContain(encodeURIComponent('Document requirements are unavailable'))
  })

  it('routes invalid review requirements to a recoverable in-flow prompt', () => {
    const url = reviewStepRedirect('tok', { ok: false, code: 'INVALID_IDENTITY_BASIS' })
    expect(url.startsWith('/provider/verify/tok?upload_error=')).toBe(true)
    expect(url).toContain(encodeURIComponent('Document requirements are unavailable'))
  })

  it('routes a missing selfie to a controlled prompt', () => {
    expect(selfieStepRedirect('tok', { ok: false, code: 'MISSING_SELFIE' })).toBe(
      '/provider/verify/tok?missing=selfie',
    )
  })

  it('surfaces identifier validation messages in-flow', () => {
    const url = identifierStepRedirect('tok', {
      ok: false,
      code: 'INVALID_DETAILS',
      message: 'Enter a valid 13-digit South African ID number.',
    })
    expect(url.startsWith('/provider/verify/tok?error=')).toBe(true)
    expect(url).toContain(encodeURIComponent('Enter a valid 13-digit South African ID number.'))
  })

  it('recovers from an expired token by reloading the page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      mapVerificationActionError('tok', new ProviderVerificationTokenError('TOKEN_EXPIRED', 'expired')),
    ).toBe('/provider/verify/tok')
    spy.mockRestore()
  })

  it('recovers from a stale invalid transition by reloading current state', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      mapVerificationActionError('tok', new IdentityVerificationTransitionError('INVALID_TRANSITION', 'stale')),
    ).toBe('/provider/verify/tok')
    spy.mockRestore()
  })

  it('shows a recoverable message for unexpected errors and never rethrows', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const url = mapVerificationActionError('tok', new Error('database exploded'))
    expect(url.startsWith('/provider/verify/tok?upload_error=')).toBe(true)
    expect(url).not.toContain('database exploded')
    spy.mockRestore()
  })
})
