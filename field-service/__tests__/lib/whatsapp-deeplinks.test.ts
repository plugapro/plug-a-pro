import { describe, it, expect } from 'vitest'
import { matchDeeplink, DEEPLINK_TOKENS } from '@/lib/whatsapp-deeplinks'

describe('matchDeeplink', () => {
  it('matches the canonical register-provider token, case-insensitive, trimmed', () => {
    expect(matchDeeplink('Register provider')).toBe('register_provider')
    expect(matchDeeplink('register provider')).toBe('register_provider')
    expect(matchDeeplink('  REGISTER PROVIDER  ')).toBe('register_provider')
  })

  it('matches when the token is followed by trailing content', () => {
    expect(matchDeeplink('Register provider 🛠️')).toBe('register_provider')
  })

  it('returns null for unrelated text', () => {
    expect(matchDeeplink('Hi')).toBeNull()
    expect(matchDeeplink('I want to book a plumber')).toBeNull()
    expect(matchDeeplink('')).toBeNull()
    expect(matchDeeplink(null)).toBeNull()
    expect(matchDeeplink(undefined)).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(matchDeeplink(' ')).toBeNull()
    expect(matchDeeplink('\n')).toBeNull()
  })

  it('exports the canonical token list so the ops doc can stay in sync', () => {
    expect(DEEPLINK_TOKENS.register_provider).toBe('Register provider')
  })
})
