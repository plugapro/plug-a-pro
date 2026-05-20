import { describe, it, expect } from 'vitest'
import {
  generateVoucherCode,
  normalizeVoucherCode,
  voucherCodeToHash,
  VOUCHER_CODE_REGEX,
} from '../../lib/vouchers'

describe('generateVoucherCode', () => {
  it('produces codes matching PAP-XXXX-XXXX format', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateVoucherCode()
      expect(code).toMatch(VOUCHER_CODE_REGEX)
    }
  })

  it('does not produce duplicate codes across 1000 generations', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateVoucherCode()))
    expect(codes.size).toBe(1000)
  })
})

describe('normalizeVoucherCode', () => {
  it('strips whitespace, uppercases, and removes dashes', () => {
    expect(normalizeVoucherCode('  pap-7kq9-m2xd  ')).toBe('PAP7KQ9M2XD')
    expect(normalizeVoucherCode('PAP-7KQ9-M2XD')).toBe('PAP7KQ9M2XD')
    expect(normalizeVoucherCode('pap7kq9m2xd')).toBe('PAP7KQ9M2XD')
  })
})

describe('voucherCodeToHash', () => {
  it('produces a 64-char hex string', () => {
    const hash = voucherCodeToHash('PAP-7KQ9-M2XD')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic — same input produces same hash', () => {
    expect(voucherCodeToHash('PAP-7KQ9-M2XD')).toBe(voucherCodeToHash('pap-7kq9-m2xd'))
    expect(voucherCodeToHash('PAP-7KQ9-M2XD')).toBe(voucherCodeToHash(' PAP-7KQ9-M2XD '))
    expect(voucherCodeToHash('PAP-7KQ9-M2XD')).toBe(voucherCodeToHash('PAP7KQ9M2XD'))
  })

  it('different codes produce different hashes', () => {
    expect(voucherCodeToHash('PAP-7KQ9-M2XD')).not.toBe(voucherCodeToHash('PAP-7KQ9-M2XE'))
  })
})
