import { describe, expect, it } from 'vitest'
import {
  PROVIDER_CHANNEL_RESPONSIBILITIES,
  coreProviderActionHasWhatsAppPath,
  getCoreProviderChannelResponsibilities,
  getProviderChannelResponsibility,
} from '../../lib/provider-channel-responsibility'

describe('provider channel responsibility model', () => {
  it('keeps every core provider action WhatsApp-owned or explicitly blocked', () => {
    const coreActions = getCoreProviderChannelResponsibilities()

    expect(coreActions.length).toBeGreaterThan(0)
    expect(coreActions.every((item) => item.primaryChannel === 'whatsapp')).toBe(true)
    expect(coreActions.every(coreProviderActionHasWhatsAppPath)).toBe(true)
  })

  it('keeps PWA-only ownership limited to non-core rich screens', () => {
    const pwaPrimary = PROVIDER_CHANNEL_RESPONSIBILITIES.filter((item) => item.primaryChannel === 'pwa')

    expect(pwaPrimary.map((item) => item.id).sort()).toEqual([
      'advanced_dashboard',
      'credit_ledger_history',
    ])
    expect(pwaPrimary.every((item) => item.core === false)).toBe(true)
  })

  it('marks every core action as having an existing WhatsApp path with no remaining blockers', () => {
    expect(getProviderChannelResponsibility('interest_response')?.whatsapp).toBe('existing')
    expect(getProviderChannelResponsibility('interest_response')?.blocker).toBeUndefined()
    expect(getProviderChannelResponsibility('opportunity_preview')?.whatsapp).toBe('existing')
    expect(getProviderChannelResponsibility('opportunity_preview')?.blocker).toBeUndefined()
    expect(getProviderChannelResponsibility('full_customer_details')?.whatsapp).toBe('existing')
    expect(getProviderChannelResponsibility('full_customer_details')?.blocker).toBeUndefined()
    expect(getProviderChannelResponsibility('arrival_confirmation')?.whatsapp).toBe('existing')
    expect(getProviderChannelResponsibility('arrival_confirmation')?.blocker).toBeUndefined()
    expect(getProviderChannelResponsibility('completion')?.whatsapp).toBe('existing')
    expect(getProviderChannelResponsibility('completion')?.blocker).toBeUndefined()
  })
})
