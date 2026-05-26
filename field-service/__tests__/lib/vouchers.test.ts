import { describe, it, expect } from 'vitest'
import {
  generateVoucherCode,
  mapVoucherRedemptionErrorToMessage,
  normalizeVoucherCode,
  parseVoucherCode,
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

describe('parseVoucherCode', () => {
  // Canonical form: each successful parse returns this string and a hash matching
  // voucherCodeToHash('PAP-7KQ9-M2XD'). Hash determinism is the key invariant — the
  // 200 codes already printed and stored in production must keep resolving.
  const CANONICAL = 'PAP-7KQ9-M2XD'
  const EXPECTED_HASH = voucherCodeToHash(CANONICAL)

  const expectCanonical = (raw: string) => {
    const result = parseVoucherCode(raw)
    expect(result.ok, `parseVoucherCode(${JSON.stringify(raw)}) should succeed`).toBe(true)
    if (result.ok) {
      expect(result.canonical).toBe(CANONICAL)
      expect(result.codeHash).toBe(EXPECTED_HASH)
    }
  }

  const expectFailure = (raw: string, reason: 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_CHARS' | 'MALFORMED') => {
    const result = parseVoucherCode(raw)
    expect(result.ok, `parseVoucherCode(${JSON.stringify(raw)}) should fail`).toBe(false)
    if (!result.ok) expect(result.reason).toBe(reason)
  }

  describe('accepted shapes', () => {
    it('accepts canonical PAP-XXXX-XXXX', () => expectCanonical('PAP-7KQ9-M2XD'))
    it('accepts lower case', () => expectCanonical('pap-7kq9-m2xd'))
    it('accepts mixed case', () => expectCanonical('Pap-7Kq9-m2Xd'))
    it('accepts dashless full form PAPXXXXXXXX', () => expectCanonical('PAP7KQ9M2XD'))
    it('accepts suffix only XXXXXXXX (PAP- is constant)', () => expectCanonical('7KQ9M2XD'))
    it('accepts lower-case suffix only', () => expectCanonical('7kq9m2xd'))
    it('accepts space-separated PAP and segments', () => expectCanonical('PAP 7KQ9 M2XD'))
    it('accepts spaces between every character', () => expectCanonical('7 K Q 9 M 2 X D'))
    it('accepts em-dashes between segments', () => expectCanonical('PAP—7KQ9—M2XD'))
    it('accepts en-dashes between segments', () => expectCanonical('PAP–7KQ9–M2XD'))
    it('accepts dot separators', () => expectCanonical('PAP.7KQ9.M2XD'))
    it('accepts underscore separators', () => expectCanonical('pap_7kq9_m2xd'))
    it('strips leading and trailing whitespace incl. newlines', () => expectCanonical('  PAP-7KQ9-M2XD\n'))
    it('strips a zero-width space', () => expectCanonical('PAP-7KQ9-M2XD​'))
  })

  describe('rejections', () => {
    it('rejects empty string as EMPTY', () => expectFailure('', 'EMPTY'))
    it('rejects whitespace-only as EMPTY', () => expectFailure('   ', 'EMPTY'))
    it('rejects separator-only as EMPTY', () => expectFailure('-- --', 'EMPTY'))

    it('rejects 4-char input as TOO_SHORT', () => expectFailure('7KQ9', 'TOO_SHORT'))
    it('rejects PAP+partial suffix as TOO_SHORT', () => expectFailure('PAP-7K', 'TOO_SHORT'))
    it('rejects 7-char suffix as TOO_SHORT', () => expectFailure('7KQ9M2X', 'TOO_SHORT'))

    it('rejects 9-char suffix as TOO_LONG', () => expectFailure('7KQ9M2XD2', 'TOO_LONG'))
    it('rejects PAP+9-char as TOO_LONG', () => expectFailure('PAP-7KQ9-M2XDZ', 'TOO_LONG'))

    it('rejects O (visual confusable for 0/Q) as INVALID_CHARS', () => expectFailure('7KQ9M2XO', 'INVALID_CHARS'))
    it('rejects I (visual confusable for 1) as INVALID_CHARS', () => expectFailure('7KQ9M2XI', 'INVALID_CHARS'))
    it('rejects L (visual confusable for 1/I) as INVALID_CHARS', () => expectFailure('7KQ9M2XL', 'INVALID_CHARS'))
    it('rejects 0 (not in charset) as INVALID_CHARS', () => expectFailure('7KQ9M2X0', 'INVALID_CHARS'))
    it('rejects 1 (not in charset) as INVALID_CHARS', () => expectFailure('7KQ9M2X1', 'INVALID_CHARS'))
    it('rejects an emoji as INVALID_CHARS', () => expectFailure('7KQ9M2X😀', 'INVALID_CHARS'))
  })

  describe('mapVoucherRedemptionErrorToMessage — new parse-failure codes', () => {
    it('maps VOUCHER_CODE_EMPTY to a friendly prompt', () => {
      expect(mapVoucherRedemptionErrorToMessage('VOUCHER_CODE_EMPTY')).toMatch(/voucher code/i)
    })
    it('maps VOUCHER_CODE_TOO_SHORT to a length hint that mentions 8 characters', () => {
      const msg = mapVoucherRedemptionErrorToMessage('VOUCHER_CODE_TOO_SHORT')
      expect(msg).toMatch(/too short/i)
      expect(msg).toMatch(/8 characters/i)
    })
    it('maps VOUCHER_CODE_TOO_LONG to a length hint that mentions 8 characters', () => {
      const msg = mapVoucherRedemptionErrorToMessage('VOUCHER_CODE_TOO_LONG')
      expect(msg).toMatch(/too long/i)
      expect(msg).toMatch(/8 characters/i)
    })
    it('maps VOUCHER_CODE_INVALID_CHARS to a hint naming the excluded characters', () => {
      const msg = mapVoucherRedemptionErrorToMessage('VOUCHER_CODE_INVALID_CHARS')
      // The charset deliberately excludes these visual confusables; the message must call them out.
      for (const ch of ['O', 'I', 'L', '0', '1']) expect(msg).toContain(ch)
    })
  })

  describe('hash determinism with voucherCodeToHash', () => {
    it.each([
      ['PAP-7KQ9-M2XD'],
      ['pap-7kq9-m2xd'],
      ['PAP7KQ9M2XD'],
      ['7KQ9M2XD'],
      ['PAP 7KQ9 M2XD'],
      ['PAP—7KQ9—M2XD'],
    ])('parses %s to the same hash as voucherCodeToHash("PAP-7KQ9-M2XD")', (input) => {
      const result = parseVoucherCode(input)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.codeHash).toBe(voucherCodeToHash('PAP-7KQ9-M2XD'))
    })
  })
})
