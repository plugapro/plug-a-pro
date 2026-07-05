import { describe, expect, it } from 'vitest'
import { safeProviderStatusReason } from '@/lib/whatsapp-flows/provider-journey'

describe('safeProviderStatusReason', () => {
  it('strips [quality-gate] marker line but keeps the real reason on another line', () => {
    const input = '[quality-gate] KYC failed at application\nMissing evidence photos'
    const result = safeProviderStatusReason(input)
    expect(result).not.toContain('[quality-gate]')
    expect(result).toContain('Missing evidence photos')
    expect(result).toBe('\nReason: Missing evidence photos')
  })

  it('returns empty string when reason contains only marker lines', () => {
    const input = '[quality-gate] KYC failed at application'
    const result = safeProviderStatusReason(input)
    expect(result).toBe('')
  })

  it('passes through normal reason text unchanged', () => {
    const input = 'Your profile does not meet requirements'
    const result = safeProviderStatusReason(input)
    expect(result).toBe('\nReason: Your profile does not meet requirements')
  })

  it('strips multiple marker lines but keeps human text', () => {
    const input = '[quality-gate] KYC failed\n[ops-review-support] Contact ops\nActual reason here'
    const result = safeProviderStatusReason(input)
    expect(result).not.toContain('[quality-gate]')
    expect(result).not.toContain('[ops-review-support]')
    expect(result).toContain('Actual reason here')
  })

  it('handles null and undefined by returning empty string', () => {
    expect(safeProviderStatusReason(null)).toBe('')
    expect(safeProviderStatusReason(undefined)).toBe('')
  })

  it('handles whitespace-only string by returning empty string', () => {
    expect(safeProviderStatusReason('   ')).toBe('')
    expect(safeProviderStatusReason('\n\n')).toBe('')
  })
})
