import { describe, expect, it } from 'vitest'
import { readRecoveryErrorMessage } from '@/lib/recovery-error-message'

describe('readRecoveryErrorMessage', () => {
  it('reads from a real Error instance', () => {
    const error = new Error('[TEMPLATE_NOT_APPROVED] Template "provider_recovery_welcome_idle" is not approved. code=132001')
    expect(readRecoveryErrorMessage(error)).toContain('[TEMPLATE_NOT_APPROVED]')
  })

  it('reads from a plain object with a message field — the case `instanceof Error` misses', () => {
    // Simulates a Turbopack-bundled error where the Error class identity has
    // drifted across module boundaries. The shape is still ducktypable.
    const errorLike = { name: 'Error', message: '[TEMPLATE_NOT_APPROVED] code=132001', stack: 'irrelevant' }
    expect(readRecoveryErrorMessage(errorLike)).toBe('[TEMPLATE_NOT_APPROVED] code=132001')
  })

  it('reads from a bare string', () => {
    expect(readRecoveryErrorMessage('WhatsApp send failed: {"error":{"code":131026}}')).toBe(
      'WhatsApp send failed: {"error":{"code":131026}}',
    )
  })

  it('returns null for null, undefined, empty string, or non-message objects', () => {
    expect(readRecoveryErrorMessage(null)).toBeNull()
    expect(readRecoveryErrorMessage(undefined)).toBeNull()
    expect(readRecoveryErrorMessage('')).toBeNull()
    expect(readRecoveryErrorMessage({ name: 'NoMessage' })).toBeNull()
    expect(readRecoveryErrorMessage({ message: 42 })).toBeNull()
    expect(readRecoveryErrorMessage({ message: '' })).toBeNull()
  })

  it('handles subclassed Error instances', () => {
    class TemplateError extends Error {}
    const error = new TemplateError('[TEMPLATE_NOT_APPROVED] code=132001')
    expect(readRecoveryErrorMessage(error)).toBe('[TEMPLATE_NOT_APPROVED] code=132001')
  })
})
