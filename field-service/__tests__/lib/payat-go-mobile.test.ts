import { describe, expect, it } from 'vitest'
import { normalizePayAtGoMobile } from '@/lib/payat-go/mobile'

describe('normalizePayAtGoMobile', () => {
  it('normalizes common ZA mobile formats to E.164', () => {
    expect(normalizePayAtGoMobile('0831234567')).toBe('+27831234567')
    expect(normalizePayAtGoMobile('27831234567')).toBe('+27831234567')
    expect(normalizePayAtGoMobile('+27831234567')).toBe('+27831234567')
  })

  it('rejects invalid numbers', () => {
    expect(() => normalizePayAtGoMobile('123')).toThrow('Enter a valid South African mobile number.')
  })
})
