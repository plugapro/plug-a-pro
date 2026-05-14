import { describe, expect, it } from 'vitest'
import {
  OTP_VERIFY_STATE_TTL_MS,
  loadOtpVerifyState,
  parseOtpVerifyState,
  saveOtpVerifyState,
  serializeOtpVerifyState,
} from '@/lib/otp-verify-state'

describe('OTP verify state persistence', () => {
  const now = new Date('2026-05-14T10:00:00.000Z').getTime()

  it('round-trips the phone and continuation path for a recent verify state', () => {
    const raw = serializeOtpVerifyState({
      phone: '+27823035070',
      next: '/leads/access/test-token',
      savedAt: now,
    })

    expect(parseOtpVerifyState(raw, now + 30_000)).toEqual({
      phone: '+27823035070',
      next: '/leads/access/test-token',
      savedAt: now,
    })
  })

  it('keeps optional customer signup context when present', () => {
    const raw = serializeOtpVerifyState({
      phone: '+27773923802',
      next: '/services',
      name: 'Sarah',
      intent: 'signup',
      savedAt: now,
    })

    expect(parseOtpVerifyState(raw, now)).toMatchObject({
      phone: '+27773923802',
      name: 'Sarah',
      intent: 'signup',
    })
  })

  it('ignores expired verify state instead of restoring a stale OTP screen', () => {
    const raw = serializeOtpVerifyState({
      phone: '+27823035070',
      next: '/provider/jobs',
      savedAt: now,
    })

    expect(parseOtpVerifyState(raw, now + OTP_VERIFY_STATE_TTL_MS + 1)).toBeNull()
  })

  it('ignores malformed or incomplete state', () => {
    expect(parseOtpVerifyState('not-json', now)).toBeNull()
    expect(parseOtpVerifyState(JSON.stringify({ next: '/provider/jobs', savedAt: now }), now)).toBeNull()
    expect(parseOtpVerifyState(JSON.stringify({ phone: '+27823035070' }), now)).toBeNull()
  })

  it('treats storage failures as non-fatal recovery misses', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }

    expect(() => saveOtpVerifyState(storage, 'otp', {
      phone: '+27823035070',
      savedAt: now,
    })).not.toThrow()
    expect(loadOtpVerifyState(storage, 'otp')).toBeNull()
  })
})
