import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_APPLY_BUTTON_TITLE,
  PROVIDER_CREDITS_PRICE_LINE,
  PROVIDER_NOT_NOW_BUTTON_TITLE,
  buildInsufficientCreditsMessage,
  buildLeadAcceptedCreditLine,
  buildProviderApplicationSubmittedMessage,
  buildProviderCreditSummaryMessage,
  buildProviderLeadActionsMessage,
  buildProviderLeadPreviewMessage,
  buildProviderOnboardingIntroMessage,
  getProviderTermsUrl,
  getPublicAppUrl,
  getWorkerPortalUrl,
} from '@/lib/provider-credit-copy'

describe('getPublicAppUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers APP_PUBLIC_URL over NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.com')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    expect(getPublicAppUrl('/provider')).toBe('https://app.example.com/provider')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when APP_PUBLIC_URL is not set', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')

    expect(getPublicAppUrl('/provider')).toBe('https://app.example.com/provider')
  })

  it('strips trailing slash from base URL before appending path', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.com/')

    expect(getPublicAppUrl('/provider/terms/credits')).toBe('https://app.example.com/provider/terms/credits')
  })

  it('safely joins paths with duplicate leading slashes', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.plugapro.co.za/')

    expect(getPublicAppUrl('//provider')).toBe('https://app.plugapro.co.za/provider')
  })

  it('returns empty string when no base URL is configured', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')

    expect(getPublicAppUrl('/provider')).toBe('')
  })

  it('logs a config error in production when base URL contains localhost', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'production')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    getPublicAppUrl('/provider')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('CONFIG ERROR'),
      expect.any(Object),
    )
    consoleSpy.mockRestore()
  })

  it('does not log a config error in development when base URL contains localhost', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'development')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    getPublicAppUrl('/provider')

    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('getWorkerPortalUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns full portal URL when APP_PUBLIC_URL is configured', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.com')

    expect(getWorkerPortalUrl('/provider')).toBe('https://app.example.com/provider')
    expect(getWorkerPortalUrl('/provider/credits')).toBe('https://app.example.com/provider/credits')
  })

  it('returns empty string when no base URL is configured', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')

    expect(getWorkerPortalUrl('/provider')).toBe('')
  })
})

describe('provider credit copy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('documents the provider credits business price without financial-credit wording', () => {
    expect(PROVIDER_CREDITS_PRICE_LINE).toBe('1 credit = R50.')
  })

  it('builds a configurable provider terms URL', () => {
    vi.stubEnv('PROVIDER_TERMS_URL', 'https://terms.example.com/provider')

    expect(getProviderTermsUrl()).toBe('https://terms.example.com/provider')
  })

  it('blocks localhost provider terms URL in production', () => {
    vi.stubEnv('PROVIDER_TERMS_URL', 'http://localhost:3000/provider/terms/credits')
    vi.stubEnv('NODE_ENV', 'production')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(getProviderTermsUrl()).toBe('')
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('CONFIG ERROR'),
      expect.any(Object),
    )
    consoleSpy.mockRestore()
  })

  it('returns empty terms URL when no base URL is configured', () => {
    vi.stubEnv('PROVIDER_TERMS_URL', '')
    vi.stubEnv('NEXT_PUBLIC_PROVIDER_TERMS_URL', '')
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')

    expect(getProviderTermsUrl()).toBe('')
  })

  it('builds a full terms URL from APP_PUBLIC_URL when specific vars are absent', () => {
    vi.stubEnv('PROVIDER_TERMS_URL', '')
    vi.stubEnv('NEXT_PUBLIC_PROVIDER_TERMS_URL', '')
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.com/')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    expect(getProviderTermsUrl()).toBe('https://app.example.com/provider/terms/credits')
  })

  it('builds a full terms URL from NEXT_PUBLIC_APP_URL when specific vars are absent', () => {
    vi.stubEnv('PROVIDER_TERMS_URL', '')
    vi.stubEnv('NEXT_PUBLIC_PROVIDER_TERMS_URL', '')
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/')

    expect(getProviderTermsUrl()).toBe('https://app.example.com/provider/terms/credits')
  })

  it('builds onboarding intro copy with terms and lead credits rules — body has no raw URL', () => {
    const message = buildProviderOnboardingIntroMessage()

    expect(message).toContain('We review your application using the information you provide')
    expect(message).toContain('starter credits')
    expect(message).toContain('Credits are prepaid platform units, not cash, loans, or financial credit')
    expect(message).toContain('1 credit = R50')
    expect(message).toContain('Previewing and showing interest in jobs is free')
    expect(message).toContain('You spend 1 credit only when a customer selects you')
    expect(message).toContain('Full customer and job details unlock after selected-job acceptance')
    // The terms URL is exposed via a sendCtaUrl follow-up, never inline.
    expect(message).toContain('View credits rules')
    expect(message).not.toMatch(/https?:\/\//)
    expect(message).not.toContain('app.plugapro.co.za')
    expect(message.toLowerCase()).not.toContain('promo pilot')
  })

  it('keeps WhatsApp onboarding button labels within Meta limits', () => {
    expect(PROVIDER_APPLY_BUTTON_TITLE.length).toBeLessThanOrEqual(20)
    expect(PROVIDER_NOT_NOW_BUTTON_TITLE.length).toBeLessThanOrEqual(20)
  })

  it('builds application submitted copy with review and approval wording — body has no raw URL', () => {
    const message = buildProviderApplicationSubmittedMessage({
      providerName: 'Jacob Hesser',
      applicationRef: 'APP123',
      // termsUrl param is preserved for backward compat but must NOT appear in body.
      termsUrl: 'https://example.com/provider-terms',
    })

    expect(message).toContain('Application submitted')
    expect(message).toContain('We will review your details')
    expect(message).toContain('Approval is not automatic')
    expect(message).toContain('If approved, your provider profile will be activated')
    expect(message).toContain('starter credits for customer-selected jobs')
    expect(message).toContain('Provider credits terms and rules')
    // The terms URL is exposed via a sendCtaUrl follow-up, never inline.
    expect(message).toContain('View credits rules')
    expect(message).not.toMatch(/https?:\/\//)
    expect(message).not.toContain('example.com')
  })

  it('builds lead preview copy with credit cost and customer detail unlock rules — body has no raw URL', () => {
    const message = buildProviderLeadPreviewMessage({
      category: 'Plumbing',
      subcategory: 'Blocked drain',
      area: 'Soweto',
      city: 'Johannesburg',
      province: 'Gauteng',
      region: 'JHB South',
      urgency: 'soon',
      matchingPreference: 'best_value',
      photosCount: 2,
      preferredTime: 'Fri, 1 May, 10:00',
      deadlineTime: '12:00',
      description: 'Shower drain is blocked.',
      // previewUrl param has been removed — the signed lead URL is exposed via
      // dispatch.ts's sendCtaUrl ("View Lead" CTA), not inline in the body.
      balance: {
        totalCreditBalance: 2,
        promoCreditBalance: 1,
        paidCreditBalance: 1,
      },
    })

    expect(message).toContain('New Job Opportunity')
    expect(message).toContain('Subcategory: *Blocked drain*')
    expect(message).toContain('Area: *Soweto, Johannesburg, Gauteng*')
    expect(message).toContain('Region: *JHB South*')
    expect(message).toContain('Urgency: *soon*')
    expect(message).toContain('Matching preference: *Best value*')
    expect(message).toContain('Photos: *2 available*')
    expect(message).toContain('Shower drain is blocked.')
    expect(message).toContain('Previewing and responding is free')
    expect(message).toContain('1 credit = R50')
    expect(message).toContain('You spend 1 credit only if the customer selects you')
    expect(message).toContain('Full customer contact and exact address stay locked')
    expect(message).toContain('Available credits: 2 credits')
    expect(message).not.toMatch(/https?:\/\//)
    expect(message).not.toContain('app.plugapro.co.za')
    expect(message).not.toContain('customer@example.com')
    expect(message).not.toContain('+27821234567')
    expect(message).not.toContain('12 Exact Street')
    expect(message).not.toContain('access notes')
  })

  it('builds insufficient credit copy with balance and top-up link', () => {
    const message = buildInsufficientCreditsMessage({
      availableCredits: 0,
      creditsRequired: 1,
      topupUrl: 'https://example.com/provider/credits',
    })

    expect(message).toContain('Not enough credits')
    expect(message).toContain('You need 1 credit to accept this selected job')
    expect(message).toContain('Your current credits balance is 0 credits')
    expect(message).toContain('top-up link is available below')
    expect(message).not.toContain('https://')
  })

  it('builds lead accepted credit line with correct deduction and remaining balance', () => {
    const line = buildLeadAcceptedCreditLine({ creditsUsed: 1, remainingCredits: 4 })

    expect(line).toContain('1 credit used')
    expect(line).toContain('Remaining credits: 4 credits')
  })

  it('buildLeadAcceptedCreditLine includes breakdown when paid/starter credits are provided', () => {
    const line = buildLeadAcceptedCreditLine({
      creditsUsed: 1,
      remainingCredits: 3,
      paidCredits: 1,
      starterCredits: 2,
    })

    expect(line).toContain('Starter/onboarding: 2')
    expect(line).toContain('Purchased: 1')
  })

  it('buildLeadAcceptedCreditLine omits breakdown when paid/starter credits are absent', () => {
    const line = buildLeadAcceptedCreditLine({ creditsUsed: 1, remainingCredits: 3 })

    expect(line).not.toContain('Starter/onboarding')
    expect(line).not.toContain('Purchased')
  })

  it('builds WhatsApp credit summary with starter, purchased, CTA prompt, and selected-job rule', () => {
    const message = buildProviderCreditSummaryMessage(
      { totalCreditBalance: 5, promoCreditBalance: 3, paidCreditBalance: 2 },
    )

    expect(message).toContain('Your credits')
    expect(message).toContain('Credits are prepaid platform units, not cash, loans, or financial credit')
    expect(message).toContain('1 credit = R50')
    expect(message).toContain('Available: 5')
    expect(message).toContain('Starter/onboarding: 3')
    expect(message).toContain('Purchased: 2')
    expect(message).toContain('Credits are used only when you accept a customer-selected job')
    expect(message).toContain('Previewing, showing interest, shortlisting, customer selection, declining, and expiry do not use credits')
    expect(message).toContain('Credits history is available below')
    expect(message).not.toContain('https://')
  })

  it('buildProviderLeadActionsMessage includes credit cost and unlock rules', () => {
    const message = buildProviderLeadActionsMessage({
      category: 'Electrical',
      area: 'Sandton',
      balance: { totalCreditBalance: 5, promoCreditBalance: 3, paidCreditBalance: 2 },
    })

    expect(message).toContain('Electrical')
    expect(message).toContain('Sandton')
    expect(message).toContain('Showing interest is free')
    expect(message).toContain('after customer selection and your final acceptance')
    expect(message).toContain('Full customer details unlock only after selected-job acceptance succeeds')
    expect(message).toContain('Available credits: 5 credits')
  })
})
