import { describe, it, expect } from 'vitest'
import {
  WHATSAPP_COPY,
  ctaLabelFor,
  ctaLink,
  bodyContainsRawUrl,
  assertNoRawUrlsInWhatsAppBody,
  bodyContainsAppCentredPhrase,
  type WhatsAppCtaLink,
} from '@/lib/whatsapp-copy'

describe('WHATSAPP_COPY constants', () => {
  it('uses customer-centred continuation copy, never "Shall I"', () => {
    expect(WHATSAPP_COPY.confirmContinue).toBe('Should we continue?')
    expect(WHATSAPP_COPY.confirmSubmitApplication).toBe('Ready to submit your application?')
    expect(WHATSAPP_COPY.confirmSubmitRequest).toBe('Ready to submit this request?')

    for (const value of Object.values(WHATSAPP_COPY)) {
      expect(value).not.toMatch(/\bShall I\b/)
      expect(value).not.toMatch(/\bWould you like me to\b/i)
      expect(value).not.toMatch(/\bDo you want me to\b/i)
    }
  })

  it('exposes the standard button labels used across flows', () => {
    expect(WHATSAPP_COPY.continueButton).toBe('✅ Continue')
    expect(WHATSAPP_COPY.changeSkillsButton).toBe('✏️ Change skills')
    expect(WHATSAPP_COPY.submitButton).toBe('✅ Submit')
    expect(WHATSAPP_COPY.cancelButton).toBe('❌ Cancel')
  })
})

describe('ctaLabelFor / ctaLink', () => {
  it('returns short, action-based labels for each documented purpose', () => {
    expect(ctaLabelFor('view_lead')).toBe('View lead')
    expect(ctaLabelFor('view_job')).toBe('View job')
    expect(ctaLabelFor('view_request')).toBe('View request')
    expect(ctaLabelFor('view_provider')).toBe('View provider')
    expect(ctaLabelFor('accept_job')).toBe('Accept job')
    expect(ctaLabelFor('check_status')).toBe('Check status')
    expect(ctaLabelFor('worker_portal')).toBe('Open Worker Portal')
    expect(ctaLabelFor('credits_rules')).toBe('View credits rules')
    expect(ctaLabelFor('credits_history')).toBe('View credits history')
    expect(ctaLabelFor('provider_status')).toBe('View status')
    expect(ctaLabelFor('support')).toBe('Contact support')
    expect(ctaLabelFor('generic_details')).toBe('View details')

    expect(ctaLabelFor('credit_history')).toBe('View credits history')
    expect(ctaLabelFor('credits_terms')).toBe('View credits rules')
    expect(ctaLabelFor('buy_credits')).toBe('Buy credits')
    expect(ctaLabelFor('top_up_credits')).toBe('Top up credits')
    expect(ctaLabelFor('provider_terms')).toBe('View terms')
    expect(ctaLabelFor('application_status')).toBe('Check status')
    expect(ctaLabelFor('worker_portal')).toBe('Open Worker Portal')
    expect(ctaLabelFor('provider_profile')).toBe('Complete profile')
    expect(ctaLabelFor('identity_verification')).toBe('Complete verification')
    expect(ctaLabelFor('job_detail')).toBe('View job')
    expect(ctaLabelFor('booking_view')).toBe('View booking')
    expect(ctaLabelFor('quote_view')).toBe('View quote')
    expect(ctaLabelFor('quote_approval')).toBe('Approve quote')
    expect(ctaLabelFor('payment')).toBe('Make payment')
    expect(ctaLabelFor('invoice_view')).toBe('View invoice')
    expect(ctaLabelFor('receipt_view')).toBe('View receipt')
    expect(ctaLabelFor('support')).toBe('Contact support')
    expect(ctaLabelFor('generic_details')).toBe('View details')
  })

  it('builds a structured WhatsAppCtaLink with the default label', () => {
    const link: WhatsAppCtaLink = ctaLink('credits_terms', 'https://app.plugapro.co.za/provider/terms/credits')
    expect(link).toMatchObject({
      label: 'View credits rules',
      url: 'https://app.plugapro.co.za/provider/terms/credits',
      purpose: 'credits_terms',
    })
  })

  it('allows a label override when needed', () => {
    const link = ctaLink('worker_portal', 'https://x', { label: 'Go to portal', id: 'wp' })
    expect(link.label).toBe('Go to portal')
    expect(link.id).toBe('wp')
  })
})

describe('bodyContainsRawUrl / assertNoRawUrlsInWhatsAppBody', () => {
  it('detects https://, http://, www., and the production host', () => {
    expect(bodyContainsRawUrl('Check it: https://app.plugapro.co.za/x')).toBeTruthy()
    expect(bodyContainsRawUrl('http://example.com')).toBeTruthy()
    expect(bodyContainsRawUrl('Visit www.plugapro.co.za')).toBeTruthy()
    expect(bodyContainsRawUrl('app.plugapro.co.za is the host')).toBeTruthy()
  })

  it('detects tokenized access paths and JWT-looking tokens even without a scheme', () => {
    expect(bodyContainsRawUrl('View job details — app.plugapro.co.za/leads/access/signed-token')).toBeTruthy()
    expect(bodyContainsRawUrl('Open /leads/access/signed-token from your browser')).toBeTruthy()
    expect(bodyContainsRawUrl('Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature')).toBeTruthy()
    expect(bodyContainsRawUrl('Open app.plugapro.co.za/access/abcdefghijklmnopqrstuvwxyz1234567890')).toBeTruthy()
  })

  it('does not flag clean copy', () => {
    expect(bodyContainsRawUrl('Tap View credits rules below to read the rules.')).toBe(false)
    expect(bodyContainsRawUrl('Should we continue?')).toBe(false)
  })

  it('throws with a clear context message when called as the assertion form', () => {
    expect(() =>
      assertNoRawUrlsInWhatsAppBody('Visit https://app.plugapro.co.za/x', 'test-context')
    ).toThrowError(/raw URL.*test-context/)
  })

  it('does not throw on clean bodies', () => {
    expect(() => assertNoRawUrlsInWhatsAppBody('All clean here.', 'test-context')).not.toThrow()
  })
})

describe('bodyContainsAppCentredPhrase', () => {
  it('flags "Shall I" but not "Should we"', () => {
    expect(bodyContainsAppCentredPhrase('Shall I continue?')).toBeTruthy()
    expect(bodyContainsAppCentredPhrase('Should we continue?')).toBe(false)
  })

  it('flags "Would you like me to" / "Do you want me to"', () => {
    expect(bodyContainsAppCentredPhrase('Would you like me to send the quote?')).toBeTruthy()
    expect(bodyContainsAppCentredPhrase('Do you want me to retry?')).toBeTruthy()
  })
})

// ─── Regression: known producers must stay clean ─────────────────────────────

describe('regression: provider-credit-copy producers must not embed raw URLs', () => {
  it('buildProviderCreditSummaryMessage body has no URL and points to CTA', async () => {
    const { buildProviderCreditSummaryMessage } = await import('@/lib/provider-credit-copy')
    const body = buildProviderCreditSummaryMessage({
      totalCreditBalance: 5,
      promoCreditBalance: 3,
      paidCreditBalance: 2,
    })
    expect(bodyContainsRawUrl(body)).toBe(false)
    // Credits history CTA is sent separately via sendCtaUrl — not embedded in body
    expect(body).not.toContain('https://')
  })

  it('buildProviderApplicationSubmittedMessage body has no URL and no "Shall I"', async () => {
    const { buildProviderApplicationSubmittedMessage } = await import('@/lib/provider-credit-copy')
    const body = buildProviderApplicationSubmittedMessage({
      providerName: 'Lovemore',
      applicationRef: 'ABC12345',
      isComingSoonRegion: false,
      // Even when callers pass a termsUrl param, body must not include it.
      termsUrl: 'https://app.plugapro.co.za/provider/terms/credits',
    })
    expect(bodyContainsRawUrl(body)).toBe(false)
    expect(body).not.toMatch(/\bShall I\b/)
    expect(body).toContain('View credits rules')
  })

  it('buildProviderOnboardingIntroMessage body has no URL and no "Shall I"', async () => {
    const { buildProviderOnboardingIntroMessage } = await import('@/lib/provider-credit-copy')
    const body = buildProviderOnboardingIntroMessage()
    expect(bodyContainsRawUrl(body)).toBe(false)
    expect(body).not.toMatch(/\bShall I\b/)
    expect(body).toContain('View credits rules')
  })
})

describe('regression: provider-wallet-notifications producers must not embed raw URLs', () => {
  it('buildLowBalanceWarningMessage body has no URL', async () => {
    const { buildLowBalanceWarningMessage } = await import('@/lib/provider-wallet-notifications')
    const body = buildLowBalanceWarningMessage()
    expect(bodyContainsRawUrl(body)).toBe(false)
  })

  it('buildZeroBalanceLeadAvailableMessage body has no URL', async () => {
    const { buildZeroBalanceLeadAvailableMessage } = await import('@/lib/provider-wallet-notifications')
    const body = buildZeroBalanceLeadAvailableMessage()
    expect(bodyContainsRawUrl(body)).toBe(false)
  })
})
