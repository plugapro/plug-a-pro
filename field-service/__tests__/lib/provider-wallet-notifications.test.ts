import { describe, expect, it } from 'vitest'
import {
  buildCustomerIntroMessage,
  buildLeadUnlockedProviderMessage,
  buildLowBalanceWarningMessage,
  buildPaymentCreditedMessage,
  buildPaymentIntentCreatedMessage,
  buildZeroBalanceLeadAvailableMessage,
} from '../../lib/provider-wallet-notifications'

describe('provider wallet notification message builders', () => {
  it('builds the low-balance warning copy', () => {
    expect(buildLowBalanceWarningMessage()).toBe(
      'You have 1 Plug-A-Pro Credit left. Top up now so you do not miss new leads. R100 = 5 credits.',
    )
  })

  it('builds the zero-balance lead copy', () => {
    expect(buildZeroBalanceLeadAvailableMessage()).toBe(
      'New matched lead available, but your wallet has 0 credits. Top up R100 to unlock this and future leads.',
    )
  })

  it('builds manual EFT top-up instructions with bank details and reference', () => {
    const message = buildPaymentIntentCreatedMessage({
      amountFormatted: 'R 100,00',
      creditsToIssue: 5,
      paymentReference: 'PAP-7842-9F3K',
      bankAccount: {
        accountName: 'Plug-A-Pro Credits',
        bankName: 'Test Bank',
        accountNumber: '123456789',
        branchCode: '250655',
        accountType: 'Business current account',
      },
    })

    expect(message).toContain('R 100,00 = 5 credits')
    expect(message).toContain('Test Bank')
    expect(message).toContain('123456789')
    expect(message).toContain('Use exact reference: PAP-7842-9F3K')
  })

  it('builds the payment credited receipt copy', () => {
    expect(buildPaymentCreditedMessage(10)).toBe(
      'Payment received. Your wallet has been credited with 10 Plug-A-Pro Credits.',
    )
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

    expect(message).toContain('Lead unlocked: plumbing')
    expect(message).toContain('Customer: Zanele')
    expect(message).toContain('Phone: +27821111111')
    expect(message).toContain('12 Main Road')
  })

  it('builds the customer intro copy', () => {
    expect(buildCustomerIntroMessage({ providerName: 'Sipho Pro' })).toBe(
      'Good news — we matched you with Sipho Pro. They may contact you shortly.',
    )
  })
})
