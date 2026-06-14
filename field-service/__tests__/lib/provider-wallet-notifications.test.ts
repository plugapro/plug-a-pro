import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCustomerIntroMessage,
  buildLeadUnlockedProviderMessage,
  buildLowBalanceWarningMessage,
  buildPaymentCreditedMessage,
  buildPaymentIntentCreatedMessage,
  buildPayatTopUpInitiatedMessage,
  buildZeroBalanceLeadAvailableMessage,
} from '../../lib/provider-wallet-notifications'

describe('provider wallet notification message builders', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds the low-balance warning copy - body has no raw URL (URL is in CTA follow-up)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    const message = buildLowBalanceWarningMessage()

    expect(message).toContain('You have 1 Plug A Pro provider credit left')
    expect(message).toContain('1 credit = R50')
    expect(message).toContain('No credits are used for previewing or saying you are interested')
    expect(message).toContain('1 credit is used only when a customer selects you')
    expect(message).toContain('You can continue here on WhatsApp')
    expect(message).toContain('top up in the Worker Portal')
    expect(message).not.toMatch(/https?:\/\//)
    expect(message).not.toContain('app.example.com')
  })

  it('builds the low-balance warning copy when NEXT_PUBLIC_APP_URL is absent - still no raw URL in body', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const message = buildLowBalanceWarningMessage()

    expect(message).toContain('top up in the Worker Portal')
    expect(message).not.toContain('https://')
  })

  it('builds the zero-balance lead copy', () => {
    const message = buildZeroBalanceLeadAvailableMessage()

    expect(message).toContain('wallet has 0 credits')
    expect(message).toContain('Previewing and saying you are interested are free')
    expect(message).toContain('You need 1 credit only if the customer selects you')
    expect(message).toContain('You can continue here on WhatsApp')
  })

  it('builds manual EFT top-up instructions with bank details and reference', () => {
    const message = buildPaymentIntentCreatedMessage({
      amountFormatted: 'R 100,00',
      creditsToIssue: 2,
      paymentReference: 'PAP-7842-9F3K',
      bankAccount: {
        accountName: 'Plug A Pro provider credits',
        bankName: 'Test Bank',
        accountNumber: '123456789',
        branchCode: '250655',
        accountType: 'Business current account',
      },
    })

    expect(message).toContain('R 100,00 = 2 credits')
    expect(message).toContain('1 credit = R50')
    expect(message).toContain('No credits are used for previewing or saying you are interested')
    expect(message).toContain('1 credit is used only when a customer selects you')
    expect(message).toContain('Test Bank')
    expect(message).toContain('123456789')
    expect(message).toContain('Use exact reference: PAP-7842-9F3K')
  })

  it('builds the payment credited receipt copy', () => {
    expect(buildPaymentCreditedMessage(4)).toContain(
      'Payment received. Your wallet has been credited with 4 Plug A Pro provider credits.',
    )
    expect(buildPaymentCreditedMessage(4)).toContain('1 credit is used only when a customer selects you')
  })

  it('builds provider lead unlock copy with post-unlock customer details', () => {
    const message = buildLeadUnlockedProviderMessage({
      unlockId: 'unlock-1',
      leadId: 'lead-1',
      providerId: 'provider-1',
      providerName: 'Sipho Pro',
      providerPhone: '+27820000000',
      customerId: 'customer-1',
      customerName: 'Zanele',
      customerPhone: '+27821111111',
      category: 'plumbing',
      area: 'Sandton',
      fullAddress: '12 Main Road, Sandton, Johannesburg',
      preferredWindow: 'Wed, 29 Apr, 10:00',
      description: 'Kitchen sink leak',
    })

    expect(message).toContain('Lead accepted and unlocked: plumbing')
    expect(message).toContain('1 credit used')
    expect(message).toContain('Customer: Zanele')
    expect(message).toContain('Phone: +27821111111')
    expect(message).toContain('12 Main Road')
  })

  it('builds the customer intro copy', () => {
    expect(buildCustomerIntroMessage({ providerName: 'Sipho Pro' })).toBe(
      'Good news - we matched you with Sipho Pro. They may contact you shortly.',
    )
  })

  describe('buildPayatTopUpInitiatedMessage', () => {
    it('does not expose the Pay@ payment URL in visible WhatsApp copy', () => {
      const message = buildPayatTopUpInitiatedMessage({
        amountFormatted: 'R 100,00',
        creditsToIssue: 2,
        paymentLink: 'https://go.payat.co.za/pay/tokenized-reference',
      })

      expect(message).toContain('Pay@')
      expect(message).toContain('R 100,00 = 2 credits')
      expect(message).toContain('Tap the button below to pay')
      expect(message).not.toContain('https://')
      expect(message).not.toContain('go.payat.co.za')
      expect(message).not.toContain('tokenized-reference')
    })
  })
})
