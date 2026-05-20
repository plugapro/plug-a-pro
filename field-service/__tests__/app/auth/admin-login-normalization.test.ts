import { describe, expect, test } from 'vitest'
import { normalizeEmailInput, normalizePasswordInput } from '@/lib/auth-input'

describe('admin login input normalization', () => {
  test('normalizes email but preserves password case', () => {
    expect(normalizeEmailInput('  Lebogang@PlugAPro.co.za  ')).toBe('lebogang@plugapro.co.za')
    expect(normalizePasswordInput('  PlugAPro@Owner2026!  ')).toBe('PlugAPro@Owner2026!')
  })
})
