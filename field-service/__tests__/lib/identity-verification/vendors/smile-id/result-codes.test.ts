import { describe, it, expect } from 'vitest'
import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  SMILE_ID_EVD_FAIL_RESULT_CODES,
  SMILE_ID_EVD_TERMINAL_RESULT_CODES,
  isTerminalResultCode,
  deriveDecision,
} from '../../../../../lib/identity-verification/vendors/smile-id/result-codes'

describe('Smile ID EVD result codes', () => {
  it('PASS set contains 0810', () => {
    expect(SMILE_ID_EVD_PASS_RESULT_CODES.has('0810')).toBe(true)
  })

  it('FAIL set contains 0811, 0812, 0816, 1014', () => {
    for (const code of ['0811', '0812', '0816', '1014']) {
      expect(SMILE_ID_EVD_FAIL_RESULT_CODES.has(code)).toBe(true)
    }
  })

  it('TERMINAL set is the union of PASS and FAIL', () => {
    for (const code of ['0810', '0811', '0812', '0816', '1014']) {
      expect(SMILE_ID_EVD_TERMINAL_RESULT_CODES.has(code)).toBe(true)
    }
  })

  it('isTerminalResultCode returns true for terminal codes', () => {
    expect(isTerminalResultCode('0810')).toBe(true)
    expect(isTerminalResultCode('1014')).toBe(true)
  })

  it('isTerminalResultCode returns false for unknown codes', () => {
    expect(isTerminalResultCode('9999')).toBe(false)
    expect(isTerminalResultCode(undefined)).toBe(false)
    expect(isTerminalResultCode(null)).toBe(false)
  })

  describe('deriveDecision', () => {
    it('maps 0810 to PASS', () => {
      expect(deriveDecision('0810')).toBe('PASS')
    })

    it('maps 0811, 0812, 0816, 1014 to FAIL', () => {
      expect(deriveDecision('0811')).toBe('FAIL')
      expect(deriveDecision('0812')).toBe('FAIL')
      expect(deriveDecision('0816')).toBe('FAIL')
      expect(deriveDecision('1014')).toBe('FAIL')
    })

    it('maps unknown codes to INCONCLUSIVE', () => {
      expect(deriveDecision('9999')).toBe('INCONCLUSIVE')
      expect(deriveDecision(undefined)).toBe('INCONCLUSIVE')
      expect(deriveDecision(null)).toBe('INCONCLUSIVE')
    })
  })
})
