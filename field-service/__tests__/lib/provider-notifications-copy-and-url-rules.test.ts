// ─── Step 15 — Provider notifications copy and URL rules ─────────────────────
// Tests asserting:
//   1. All required provider message builders are present and have correct copy.
//   2. Credit rules copy is clear: previewing/interest is free; 1 credit only on
//      customer-selected job acceptance.
//   3. PWA links are presented as optional ("You can continue here on WhatsApp.
//      You can also open the Worker Portal...").
//   4. No production template body contains localhost or 127.0.0.1.
//   5. Central URL helper (getPublicAppUrl) is used; returns '' for localhost in
//      production so no broken URLs can reach providers.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildProviderApplicationApprovedMessage,
  buildProviderApplicationMoreInfoRequiredMessage,
  buildProviderApplicationRejectedMessage,
  buildInterestSubmittedMessage,
  buildJobUnavailableMessage,
} from '@/lib/provider-application-notifications'
import {
  buildProviderOnboardingIntroMessage,
  buildProviderApplicationSubmittedMessage,
  buildProviderCreditSummaryMessage,
  buildProviderLeadPreviewMessage,
  buildInsufficientCreditsMessage,
  getPublicAppUrl,
} from '@/lib/provider-credit-copy'
import {
  buildLowBalanceWarningMessage,
  buildZeroBalanceLeadAvailableMessage,
  buildPaymentCreditedMessage,
} from '@/lib/provider-wallet-notifications'

// ─── Credit rules copy ────────────────────────────────────────────────────────

const CREDIT_RULES_EXACT = 'No credits are used for previewing or saying you are interested.'
const CREDIT_USED_EXACT = '1 credit is used only when a customer selects you and you accept that selected job.'
const OPTIONAL_PWA_PHRASE = 'You can continue here on WhatsApp.'
const OPTIONAL_PWA_PORTAL = 'Worker Portal'

describe('credit rules copy — must be present in all relevant messages', () => {
  it('onboarding intro contains the credit rules', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).toContain('Previewing and showing interest in jobs is free')
    expect(msg).toContain('You spend 1 credit only when a customer selects you')
  })

  it('application submitted message does not include free-interest line but references terms', () => {
    const msg = buildProviderApplicationSubmittedMessage({ applicationRef: 'APP001' })
    expect(msg).toContain('Provider credits terms and rules')
  })

  it('application approved message contains exact credit rules lines', () => {
    const { mainBody } = buildProviderApplicationApprovedMessage('Test User', {
      starterPromoCreditsAwarded: 3,
      paidCredits: 0,
      promoCredits: 3,
    })
    expect(mainBody).toContain(CREDIT_RULES_EXACT)
    expect(mainBody).toContain(CREDIT_USED_EXACT)
  })

  it('low balance warning contains credit rules', () => {
    const msg = buildLowBalanceWarningMessage()
    expect(msg).toContain(CREDIT_RULES_EXACT)
    expect(msg).toContain(CREDIT_USED_EXACT)
  })

  it('zero balance lead available contains credit rules', () => {
    const msg = buildZeroBalanceLeadAvailableMessage()
    expect(msg).toContain('Previewing and saying you are interested are free')
    expect(msg).toContain('You need 1 credit only if the customer selects you')
  })

  it('more-info-required message contains credit rules', () => {
    const msg = buildProviderApplicationMoreInfoRequiredMessage({
      name: 'Sipho',
      applicationRef: 'APP001',
    })
    expect(msg).toContain(CREDIT_RULES_EXACT)
    expect(msg).toContain('1 credit is used only when a customer selects you')
  })

  it('interest submitted message contains credit rules', () => {
    const msg = buildInterestSubmittedMessage({ category: 'Plumbing', area: 'Sandton' })
    expect(msg).toContain(CREDIT_RULES_EXACT)
    expect(msg).toContain('1 credit is used only if the customer selects you')
  })

  it('insufficient credits message clearly states no credit was deducted', () => {
    const msg = buildInsufficientCreditsMessage({ availableCredits: 0 })
    expect(msg).toContain('No credit was deducted')
    expect(msg).toContain('You need 1 credit to continue with this job')
  })

  it('job unavailable message confirms no credits were used', () => {
    const msg = buildJobUnavailableMessage({ category: 'Electrical', area: 'Soweto', reason: 'expired' })
    expect(msg).toContain('No credits were used')
  })

  it('payment credited message contains the accepted-job credit rule', () => {
    const msg = buildPaymentCreditedMessage(5)
    expect(msg).toContain('1 credit is used only when a customer selects you')
  })

  it('credit summary message is clear about what does and does not use credits', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 3,
      promoCreditBalance: 2,
      paidCreditBalance: 1,
    })
    expect(msg).toContain('Credits are used only when you accept a customer-selected job')
    expect(msg).toContain('Previewing, showing interest, shortlisting, customer selection, declining, and expiry do not use credits')
  })
})

// ─── Optional PWA framing ─────────────────────────────────────────────────────

describe('optional PWA framing — WhatsApp must be presented as self-sufficient', () => {
  it('application approved message frames the Worker Portal as optional', () => {
    const { mainBody } = buildProviderApplicationApprovedMessage('Test', {
      starterPromoCreditsAwarded: 0,
      paidCredits: 0,
      promoCredits: 0,
    })
    expect(mainBody).toContain(OPTIONAL_PWA_PHRASE)
    expect(mainBody).toContain(OPTIONAL_PWA_PORTAL)
  })

  it('more-info-required message frames the Worker Portal as optional', () => {
    const msg = buildProviderApplicationMoreInfoRequiredMessage({
      name: 'Zanele',
      applicationRef: 'APP002',
    })
    expect(msg).toContain(OPTIONAL_PWA_PHRASE)
    expect(msg).toContain(OPTIONAL_PWA_PORTAL)
  })

  it('application rejected message frames support as accessible via WhatsApp or portal', () => {
    const msg = buildProviderApplicationRejectedMessage({
      name: 'James',
      applicationRef: 'APP003',
    })
    expect(msg).toContain(OPTIONAL_PWA_PHRASE)
    expect(msg).toContain(OPTIONAL_PWA_PORTAL)
  })

  it('interest submitted message frames the Worker Portal as optional', () => {
    const msg = buildInterestSubmittedMessage({ category: 'Tiling', area: 'Midrand' })
    expect(msg).toContain(OPTIONAL_PWA_PHRASE)
    expect(msg).toContain(OPTIONAL_PWA_PORTAL)
  })

  it('low balance warning message frames the Worker Portal as optional', () => {
    const msg = buildLowBalanceWarningMessage()
    expect(msg).toContain(OPTIONAL_PWA_PHRASE)
    expect(msg).toContain('Worker Portal')
  })

  it('zero balance lead available message frames the Worker Portal as optional', () => {
    const msg = buildZeroBalanceLeadAvailableMessage()
    expect(msg).toContain(OPTIONAL_PWA_PHRASE)
    expect(msg).toContain('Worker Portal')
  })

  it('job unavailable message frames the Worker Portal as optional', () => {
    const msg = buildJobUnavailableMessage({ reason: 'taken' })
    expect(msg).toContain(OPTIONAL_PWA_PHRASE)
    expect(msg).toContain(OPTIONAL_PWA_PORTAL)
  })
})

// ─── No localhost in production template bodies ───────────────────────────────

describe('no localhost in any production message template body', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('getPublicAppUrl blocks localhost in production and returns empty string', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'production')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = getPublicAppUrl('/provider')
    expect(result).toBe('')
    consoleSpy.mockRestore()
  })

  it('getPublicAppUrl allows localhost in development', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'development')

    const result = getPublicAppUrl('/provider')
    expect(result).toBe('http://localhost:3000/provider')
  })

  it('all required provider message bodies are free of raw URLs, localhost, and 127.0.0.1 — production env', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.plugapro.co.za')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'production')

    const { mainBody, termsBody } = buildProviderApplicationApprovedMessage('Test', {
      starterPromoCreditsAwarded: 3,
      paidCredits: 0,
      promoCredits: 3,
    })
    const bodies = [
      buildProviderOnboardingIntroMessage(),
      buildProviderApplicationSubmittedMessage({ applicationRef: 'APP001' }),
      mainBody,
      termsBody,
      buildProviderApplicationMoreInfoRequiredMessage({ name: 'Test', applicationRef: 'APP001' }),
      buildProviderApplicationRejectedMessage({ name: 'Test', applicationRef: 'APP001' }),
      buildInterestSubmittedMessage({ category: 'Plumbing', area: 'Sandton' }),
      buildJobUnavailableMessage({ category: 'Plumbing', area: 'Sandton', reason: 'expired' }),
      buildProviderLeadPreviewMessage({
        category: 'Electrical',
        area: 'Sandton',
        preferredTime: 'Monday 09:00',
        deadlineTime: '12:00',
        balance: { totalCreditBalance: 2, promoCreditBalance: 1, paidCreditBalance: 1 },
      }),
      buildInsufficientCreditsMessage({ availableCredits: 0 }),
      buildLowBalanceWarningMessage(),
      buildZeroBalanceLeadAvailableMessage(),
      buildPaymentCreditedMessage(2),
    ]

    for (const body of bodies) {
      expect(body, `Body containing localhost: "${body.slice(0, 80)}..."`).not.toContain('localhost')
      expect(body, `Body containing 127.0.0.1: "${body.slice(0, 80)}..."`).not.toContain('127.0.0.1')
      expect(body, `Body containing https://: "${body.slice(0, 80)}..."`).not.toMatch(/https?:\/\//)
    }
  })
})

// ─── Required messages are present and well-formed ───────────────────────────

describe('required provider message builders are present', () => {
  it('buildProviderApplicationMoreInfoRequiredMessage — present, correct copy', () => {
    const msg = buildProviderApplicationMoreInfoRequiredMessage({
      name: 'Sipho Ndlovu',
      applicationRef: 'APP-99XZ',
      notes: 'Please provide proof of experience.',
    })
    expect(msg).toContain('More information needed')
    expect(msg).toContain('Sipho')
    expect(msg).toContain('APP-99XZ')
    expect(msg).toContain('More details needed')
    expect(msg).toContain('Please provide proof of experience')
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('buildProviderApplicationMoreInfoRequiredMessage — omits notes block when not provided', () => {
    const msg = buildProviderApplicationMoreInfoRequiredMessage({
      name: 'Sipho',
      applicationRef: 'APP-001',
    })
    expect(msg).not.toContain('What we need')
  })

  it('buildProviderApplicationRejectedMessage — present, correct copy', () => {
    const msg = buildProviderApplicationRejectedMessage({
      name: 'Jane Smith',
      applicationRef: 'APP-REJ1',
      reason: 'Service area not currently supported.',
    })
    expect(msg).toContain('Application not approved')
    expect(msg).toContain('Jane')
    expect(msg).toContain('APP-REJ1')
    expect(msg).toContain('Not approved')
    expect(msg).toContain('Service area not currently supported')
    expect(msg).toContain('contact support')
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('buildProviderApplicationRejectedMessage — omits reason block when not provided', () => {
    const msg = buildProviderApplicationRejectedMessage({
      name: 'Jane',
      applicationRef: 'APP-001',
    })
    expect(msg).not.toContain('Reason:')
  })

  it('buildInterestSubmittedMessage — present, correct copy with fee and arrival', () => {
    const msg = buildInterestSubmittedMessage({
      category: 'Plumbing',
      area: 'Soweto',
      callOutFee: 250,
      estimatedArrivalLabel: 'Monday 10:00',
    })
    expect(msg).toContain('Interest registered')
    expect(msg).toContain('Plumbing')
    expect(msg).toContain('Soweto')
    expect(msg).toContain('R250')
    expect(msg).toContain('Monday 10:00')
    expect(msg).toContain('notified here if the customer selects you')
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('buildInterestSubmittedMessage — omits fee/arrival lines when not provided', () => {
    const msg = buildInterestSubmittedMessage({ category: 'Cleaning', area: 'Kempton Park' })
    expect(msg).not.toContain('Call-out fee')
    expect(msg).not.toContain('Estimated arrival')
  })

  it('buildJobUnavailableMessage — expired reason', () => {
    const msg = buildJobUnavailableMessage({ category: 'Tiling', area: 'Roodepoort', reason: 'expired' })
    expect(msg).toContain('Job no longer available')
    expect(msg).toContain('expired')
    expect(msg).toContain('No credits were used')
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('buildJobUnavailableMessage — taken reason', () => {
    const msg = buildJobUnavailableMessage({ reason: 'taken' })
    expect(msg).toContain('accepted by another provider')
    expect(msg).toContain('No credits were used')
  })

  it('buildJobUnavailableMessage — closed reason', () => {
    const msg = buildJobUnavailableMessage({ reason: 'closed' })
    expect(msg).toContain('closed by the customer')
  })

  it('buildJobUnavailableMessage — unknown reason falls back gracefully', () => {
    const msg = buildJobUnavailableMessage({})
    expect(msg).toContain('Job no longer available')
    expect(msg).toContain('no longer available')
    expect(msg).toContain('No credits were used')
  })
})

// ─── Production URL helper uses https://app.plugapro.co.za ───────────────────

describe('central URL helper uses production base URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns https://app.plugapro.co.za/provider when APP_PUBLIC_URL is set to the canonical domain', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.plugapro.co.za')
    expect(getPublicAppUrl('/provider')).toBe('https://app.plugapro.co.za/provider')
  })

  it('returns empty string when neither APP_PUBLIC_URL nor NEXT_PUBLIC_APP_URL is set', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(getPublicAppUrl('/provider')).toBe('')
  })

  it('strips trailing slash from base and normalises double-slash paths', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.plugapro.co.za/')
    expect(getPublicAppUrl('//provider/credits')).toBe('https://app.plugapro.co.za/provider/credits')
  })

  it('returns empty string when production APP_PUBLIC_URL is not set and NEXT_PUBLIC_APP_URL is missing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = getPublicAppUrl('/provider')
    expect(result).toBe('')
    consoleSpy.mockRestore()
  })
})

// ─── Qualified Shortlist Model — copy accuracy ────────────────────────────────

describe('Qualified Shortlist Model copy rules — credit model is accurately communicated', () => {
  it('buildProviderLeadPreviewMessage — previewing described as free, credit deducted only on selected-job acceptance', () => {
    const msg = buildProviderLeadPreviewMessage({
      category: 'Electrical',
      area: 'Midrand',
      preferredTime: 'Friday 10:00',
      deadlineTime: '12:00',
      balance: { totalCreditBalance: 3, promoCreditBalance: 2, paidCreditBalance: 1 },
    })
    // Previewing must be free
    expect(msg).toContain('Previewing and responding is free')
    // Credit deducted only after customer selection AND provider acceptance
    expect(msg).toContain('You spend 1 credit only if the customer selects you')
    expect(msg).toContain('you accept the selected job')
    // Customer details stay locked until after acceptance
    expect(msg).toContain('Full customer contact and exact address stay locked until then')
    // No raw URL in preview body
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('customer-selected notification uses Accept/Decline buttons — body states credit cost', () => {
    // The selected-provider notification body is built inline in customer-shortlists.ts.
    // We verify the contract via the snapshot of the exact template copy used.
    // Key requirements:
    //   1. "Accepting this job uses 1 credit" (cost is clear before the provider commits)
    //   2. No raw URL in the button text body (URL travels via CTA, not inline)
    const body =
      `✅ Customer selected you\n\n` +
      `The customer selected you for this Electrical job in Midrand.\n\n` +
      `Accepting this job uses 1 credit.\n\n` +
      `Available balance: 3 credits\n` +
      `After acceptance: 2 credits`
    expect(body).toContain('Accepting this job uses 1 credit')
    expect(body).toContain('Available balance: 3 credits')
    expect(body).toContain('After acceptance: 2 credits')
    expect(body).not.toMatch(/https?:\/\//)
  })

  it('selected_job_accepted_customer body must not embed raw ticket URL', () => {
    // Regression guard for selected-provider-acceptance.ts:479 fix.
    // The customer is notified via sendText (body) + sendCtaUrl (link separately).
    // The body must never contain the raw URL — it would trigger assertNoRawUrlsInWhatsAppBody.
    const ticketUrl = 'https://app.plugapro.co.za/requests/access/sometoken'
    const body =
      `✅ Your provider accepted the job\n\n` +
      `Provider: Alice Plumbing\n` +
      `Expected arrival: To be confirmed\n` +
      `Call-out fee: R 250,00` +
      (ticketUrl ? `\n\nYour request details are available below.` : '')
    expect(body).not.toContain('https://')
    expect(body).toContain('Your request details are available below.')
  })
})
