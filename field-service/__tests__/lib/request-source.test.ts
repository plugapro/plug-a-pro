import { describe, expect, it } from 'vitest'
import { normalizeRequestSource } from '@/lib/job-requests/create-job-request'

describe('normalizeRequestSource', () => {
  it.each([
    ['whatsapp', 'whatsapp'],
    ['pwa', 'pwa'],
    ['vodapay', 'vodapay'],
    [undefined, 'merged'],
    ['unknown', 'merged'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRequestSource(input as string | undefined)).toBe(expected)
  })
})
