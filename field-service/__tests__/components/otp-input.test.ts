import { describe, expect, it } from 'vitest'
import {
  applyOtpBackspace,
  applyOtpInputChange,
  normalizeOtpValue,
} from '@/components/ui/otp-input'

describe('OtpInput value handling', () => {
  it('accepts manual digit entry and moves focus to the next box', () => {
    expect(applyOtpInputChange('', 0, '0')).toEqual({ value: '0', focusIndex: 1 })
    expect(applyOtpInputChange('0', 1, '4')).toEqual({ value: '04', focusIndex: 2 })
  })

  it('preserves leading zeroes for autofill-style multi-digit input', () => {
    expect(applyOtpInputChange('', 0, '047479')).toEqual({
      value: '047479',
      focusIndex: 5,
    })
  })

  it('normalizes pasted values with spaces and non-digits', () => {
    expect(normalizeOtpValue('047 479')).toBe('047479')
    expect(normalizeOtpValue('OTP: 047-479')).toBe('047479')
  })

  it('takes only the first six digits from longer pasted or autofilled values', () => {
    expect(applyOtpInputChange('', 0, '047479999')).toEqual({
      value: '047479',
      focusIndex: 5,
    })
  })

  it('distributes a multi-digit value even when it arrives in a later box', () => {
    expect(applyOtpInputChange('12', 2, '047479')).toEqual({
      value: '047479',
      focusIndex: 5,
    })
  })

  it('removes the current digit on backspace', () => {
    expect(applyOtpBackspace('047479', 5)).toEqual({
      value: '04747',
      focusIndex: 5,
    })
  })

  it('moves focus backward when backspace is pressed on an empty box', () => {
    expect(applyOtpBackspace('047', 4)).toEqual({
      value: '047',
      focusIndex: 3,
    })
  })
})
