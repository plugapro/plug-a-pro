import { describe, expect, it } from 'vitest'
import { resolvePspProviderNameFor } from '@/lib/payments'

describe('resolvePspProviderNameFor', () => {
  it('vodapay source + flag on → vodapay', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: 'vodapay', vodapayFlagOn: true }))
      .toBe('vodapay')
  })

  it('vodapay source + flag off → global default (peach)', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: 'vodapay', vodapayFlagOn: false }))
      .toBe('peach')
  })

  it('pwa source ignores the flag', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: 'pwa', vodapayFlagOn: true }))
      .toBe('peach')
  })

  it('null source ignores the flag', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: null, vodapayFlagOn: true }))
      .toBe('peach')
  })
})
