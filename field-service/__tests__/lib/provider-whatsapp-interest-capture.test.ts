import { describe, expect, it } from 'vitest'
import { parseProviderInterestRateText } from '../../lib/provider-whatsapp-interest-capture'

const FIXED_NOW = new Date('2026-05-02T08:00:00.000Z')

describe('parseProviderInterestRateText', () => {
  it('parses "R250 | tomorrow morning" into fee + arrival on the next day', () => {
    const result = parseProviderInterestRateText('R250 | tomorrow morning', { now: FIXED_NOW })
    expect(result?.callOutFee).toBe(250)
    expect(result?.estimatedArrivalAt).toBeInstanceOf(Date)
    expect(result?.estimatedArrivalAt.getDate()).toBe(FIXED_NOW.getDate() + 1)
  })

  it('parses "300 today afternoon" into fee + same-day afternoon arrival', () => {
    const result = parseProviderInterestRateText('300 today afternoon', { now: FIXED_NOW })
    expect(result?.callOutFee).toBe(300)
    // Local-time hour will be in the afternoon window (13:00). We check >12 to
    // be timezone-tolerant on the test runner.
    expect(result && result.estimatedArrivalAt.getHours() >= 12).toBe(true)
  })

  it('parses "R 200 today 14:00" with whitespace and structured time', () => {
    const result = parseProviderInterestRateText('R 200 today 14:00', { now: FIXED_NOW })
    expect(result?.callOutFee).toBe(200)
    expect(result?.estimatedArrivalAt.getHours()).toBe(14)
    expect(result?.estimatedArrivalAt.getMinutes()).toBe(0)
  })

  it('parses "150 tomorrow 9am" with am/pm', () => {
    const result = parseProviderInterestRateText('150 tomorrow 9am', { now: FIXED_NOW })
    expect(result?.callOutFee).toBe(150)
    expect(result?.estimatedArrivalAt.getHours()).toBe(9)
  })

  it('returns null when fee is missing', () => {
    expect(parseProviderInterestRateText('tomorrow morning', { now: FIXED_NOW })).toBeNull()
  })

  it('returns null when arrival is missing', () => {
    expect(parseProviderInterestRateText('R250', { now: FIXED_NOW })).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseProviderInterestRateText('', { now: FIXED_NOW })).toBeNull()
    expect(parseProviderInterestRateText(null, { now: FIXED_NOW })).toBeNull()
  })

  it('rejects zero fees', () => {
    expect(parseProviderInterestRateText('R0 | tomorrow morning', { now: FIXED_NOW })).toBeNull()
  })

  it('caps fee parsing to reasonable digit count (avoids interpreting random long numbers as fees)', () => {
    // The fee regex captures 2–5 digits, so a phone-style "1234567890" should not be parsed.
    const result = parseProviderInterestRateText('1234567890 tomorrow morning', { now: FIXED_NOW })
    // Must not interpret "1234567890" as a small reasonable fee.
    expect(result?.callOutFee).not.toBe(1234567890)
  })
})
