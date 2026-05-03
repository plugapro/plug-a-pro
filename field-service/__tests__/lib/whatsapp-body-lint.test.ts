import { describe, it, expect } from 'vitest'
import { bodyContainsRawUrl } from '@/lib/whatsapp-copy'

// ─── Repo-wide lint: every known WhatsApp customer-facing message-body
//     producer is exercised here and asserted to leave its body free of raw
//     URLs. Adding a new producer? Add a case to the table below.
//     The list intentionally favours pure-string builders that can be invoked
//     without DB / WhatsApp SDK side effects. Surfaces that compose strings
//     dynamically inside async senders (sendQuoteToClient, dispatch.ts, etc.)
//     are covered by per-flow integration tests, not this lint.

describe('repo-wide WhatsApp body-text lint — no raw URLs in customer-facing copy', () => {
  it.each([
    [
      'buildProviderApplicationSubmittedMessage',
      async () => {
        const m = await import('@/lib/provider-credit-copy')
        return m.buildProviderApplicationSubmittedMessage({
          providerName: 'Lovemore',
          applicationRef: 'APP123',
          isComingSoonRegion: false,
          // Even when callers pass a termsUrl it must NOT appear in the body.
          termsUrl: 'https://app.plugapro.co.za/provider/terms/credits',
        })
      },
    ],
    [
      'buildProviderOnboardingIntroMessage',
      async () => (await import('@/lib/provider-credit-copy')).buildProviderOnboardingIntroMessage(),
    ],
    [
      'buildLowBalanceWarningMessage',
      async () => (await import('@/lib/provider-wallet-notifications')).buildLowBalanceWarningMessage(),
    ],
    [
      'buildZeroBalanceLeadAvailableMessage',
      async () => (await import('@/lib/provider-wallet-notifications')).buildZeroBalanceLeadAvailableMessage(),
    ],
    [
      'buildProviderLeadPreviewMessage',
      async () => {
        const m = await import('@/lib/provider-credit-copy')
        return m.buildProviderLeadPreviewMessage({
          category: 'Plumbing',
          area: 'Soweto',
          preferredTime: 'Fri, 1 May, 10:00',
          deadlineTime: '12:00',
          balance: { totalCreditBalance: 5, paidCreditBalance: 2, promoCreditBalance: 3 } as never,
          subcategory: 'Blocked drain',
          city: 'Johannesburg',
          province: 'Gauteng',
          urgency: 'soon',
          matchingPreference: 'best_value',
          photosCount: 2,
          description: 'Shower drain is blocked.',
        })
      },
    ],
    [
      'buildProviderApplicationApprovedMessage.mainBody',
      async () => {
        const m = await import('@/lib/provider-application-notifications')
        return m.buildProviderApplicationApprovedMessage('Lovemore', {
          starterPromoCreditsAwarded: 3,
          paidCredits: 0,
          promoCredits: 3,
        }).mainBody
      },
    ],
    [
      'buildProviderApplicationApprovedMessage.termsBody',
      async () => {
        const m = await import('@/lib/provider-application-notifications')
        return m.buildProviderApplicationApprovedMessage('Lovemore', {
          starterPromoCreditsAwarded: 3,
          paidCredits: 0,
          promoCredits: 3,
        }).termsBody
      },
    ],
  ])('producer %s emits a body free of raw URLs', async (_name, factory) => {
    const body = await factory()
    expect(typeof body).toBe('string')
    const found = bodyContainsRawUrl(body)
    if (found) {
      throw new Error(
        `Producer leaked a raw URL into its body: matched "${found.match}" against /${found.pattern}/.\nBody preview: ${body.slice(0, 240)}`
      )
    }
    expect(found).toBe(false)
  })
})
