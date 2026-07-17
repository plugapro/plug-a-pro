import { describe, it, expect } from 'vitest'
import { redactPii, redactSentryEvent } from '@/lib/observability/sentry-redaction'

describe('redactPii', () => {
  it('redacts SA phone numbers with and without +', () => {
    expect(redactPii('call +27821234567 now')).toBe('call [REDACTED] now')
    expect(redactPii('27821234567')).toBe('[REDACTED]')
  })

  it('redacts 13-digit SA ID numbers', () => {
    expect(redactPii('id 9001015800086 ok')).toBe('id [REDACTED] ok')
  })

  it('redacts email addresses (case-insensitive)', () => {
    expect(redactPii('from Lovemore.Sibanda@Gmail.com now')).toBe('from [REDACTED] now')
    expect(redactPii('a@b.co')).toBe('[REDACTED]')
  })

  it('does not redact ordinary short numbers or amounts', () => {
    expect(redactPii('amount R150 for 3 photos')).toBe('amount R150 for 3 photos')
    expect(redactPii('order 12345')).toBe('order 12345')
  })

  it('does not clobber a 13-digit run inside a longer numeric id', () => {
    // 20-digit sequence must be left alone (not a standalone SA ID).
    const long = '12345678901234567890'
    expect(redactPii(long)).toBe(long)
  })

  it('redacts multiple occurrences in one string', () => {
    expect(redactPii('+27821234567 and 9001015800086')).toBe('[REDACTED] and [REDACTED]')
  })
})

describe('redactSentryEvent', () => {
  it('scrubs PII from nested event fields', () => {
    const event = {
      message: 'failed for +27821234567',
      extra: { idNumber: '9001015800086', note: 'fine' },
    }
    const out = redactSentryEvent(event)
    expect(out.message).toBe('failed for [REDACTED]')
    expect(out.extra.idNumber).toBe('[REDACTED]')
    expect(out.extra.note).toBe('fine')
  })

  it('returns the event unchanged when it cannot be serialized', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    // Must not throw; returns the same reference.
    expect(redactSentryEvent(circular)).toBe(circular)
  })
})
