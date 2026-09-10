import { describe, expect, it } from 'vitest'
import { detectMiniProgram } from '@/lib/vodapay/bridge'

describe('detectMiniProgram', () => {
  it('UA marker wins', () => {
    expect(detectMiniProgram('Mozilla/5.0 … MiniProgram', undefined)).toBe(true)
  })
  it('bridge object wins without UA marker', () => {
    expect(detectMiniProgram('Mozilla/5.0 Chrome', { getAuthCode: () => {} })).toBe(true)
  })
  it('plain browser is false', () => {
    expect(detectMiniProgram('Mozilla/5.0 Chrome', undefined)).toBe(false)
  })
})
