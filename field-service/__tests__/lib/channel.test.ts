import { describe, expect, it } from 'vitest'
import { parseChannelCookie } from '@/lib/channel'

describe('parseChannelCookie', () => {
  it('vodapay value → vodapay', () => expect(parseChannelCookie('vodapay')).toBe('vodapay'))
  it('missing → web', () => expect(parseChannelCookie(undefined)).toBe('web'))
  it('garbage → web', () => expect(parseChannelCookie('evil')).toBe('web'))
})
