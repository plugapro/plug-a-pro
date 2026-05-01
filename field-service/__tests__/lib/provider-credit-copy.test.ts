import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_APPLY_BUTTON_TITLE,
  PROVIDER_NOT_NOW_BUTTON_TITLE,
  buildInsufficientCreditsMessage,
  buildLeadAcceptedCreditLine,
  buildProviderApplicationSubmittedMessage,
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

  it('builds a configurable provider terms URL', () => {
    vi.stubEnv('PROVIDER_TERMS_URL', 'https://terms.example.com/provider')

    expect(getProviderTermsUrl()).toBe('https://terms.example.com/provider')
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

  it('builds onboarding intro copy with terms and lead credit rules', () => {
    const message = buildProviderOnboardingIntroMessage('https://example.com/provider/terms/credits')

    expect(message).toContain('We review your application using the information you provide')
    expect(message).toContain('starter credits')
    expect(message).toContain('Each lead you accept uses 1 credit')
    expect(message).toContain('Full customer and job details unlock after acceptance')
    expect(message).toContain('https://example.com/provider/terms/credits')
    expect(message.toLowerCase()).not.toContain('promo pilot')
  })

  it('keeps WhatsApp onboarding button labels within Meta limits', () => {
    expect(PROVIDER_APPLY_BUTTON_TITLE.length).toBeLessThanOrEqual(20)
    expect(PROVIDER_NOT_NOW_BUTTON_TITLE.length).toBeLessThanOrEqual(20)
  })

  it('builds application submitted copy with review and approval wording', () => {
    const message = buildProviderApplicationSubmittedMessage({
      providerName: 'Jacob Hesser',
      applicationRef: 'APP123',
      termsUrl: 'https://example.com/provider-terms',
    })

    expect(message).toContain('Application submitted')
    expect(message).toContain('We will review your details')
    expect(message).toContain('Approval is not automatic')
    expect(message).toContain('If approved, your provider profile will be activated')
    expect(message).toContain('starter credits')
    expect(message).toContain('https://example.com/provider-terms')
  })

  it('builds lead preview copy with credit cost and customer detail unlock rules', () => {
    const message = buildProviderLeadPreviewMessage({
      category: 'Plumbing',
      area: 'Soweto',
      preferredTime: 'Fri, 1 May, 10:00',
      deadlineTime: '12:00',
      balance: {
        totalCreditBalance: 2,
        promoCreditBalance: 1,
        paidCreditBalance: 1,
      },
    })

    expect(message).toContain('New Job Lead')
    expect(message).toContain('You can preview the job details first')
    expect(message).toContain('Accepting this lead uses 1 credit')
    expect(message).toContain('Full customer contact and exact address unlock after acceptance')
    expect(message).toContain('Available balance: 2 credits')
  })

  it('builds insufficient credit copy with balance and top-up link', () => {
    const message = buildInsufficientCreditsMessage({
      availableCredits: 0,
      creditsRequired: 1,
      topupUrl: 'https://example.com/provider/credits',
    })

    expect(message).toContain('Not enough credits')
    expect(message).toContain('You need 1 credit to accept this lead')
    expect(message).toContain('Your current balance is 0 credits')
    expect(message).toContain('https://example.com/provider/credits')
  })

  it('builds lead accepted credit line with correct deduction and remaining balance', () => {
    const line = buildLeadAcceptedCreditLine({ creditsUsed: 1, remainingCredits: 4 })

    expect(line).toContain('1 credit used')
    expect(line).toContain('Remaining balance: 4 credits')
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

  it('buildProviderLeadActionsMessage includes credit cost and unlock rules', () => {
    const message = buildProviderLeadActionsMessage({
      category: 'Electrical',
      area: 'Sandton',
      balance: { totalCreditBalance: 5, promoCreditBalance: 3, paidCreditBalance: 2 },
    })

    expect(message).toContain('Electrical')
    expect(message).toContain('Sandton')
    expect(message).toContain('Accepting this lead uses 1 credit')
    expect(message).toContain('Full customer details unlock only after acceptance succeeds')
    expect(message).toContain('Available balance: 5 credits')
  })
})
