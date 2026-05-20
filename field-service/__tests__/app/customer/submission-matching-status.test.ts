/**
 * CLIENT-06 — Submission and Matching Status Screens
 *
 * Covers:
 *  1. Status → screen resolution for PENDING_VALIDATION, OPEN, MATCHING
 *  2. WhatsApp notifications on submission and matching-in-progress
 *  3. Duplicate submission detection (DuplicateActiveRequestError)
 *  4. Token page screens: request_submitted, matching_progress, providers_reviewing
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Notification mocks ─────────────────────────────────────────────────────────
const { mockSendText, mockSendCtaUrl } = vi.hoisted(() => ({
  mockSendText: vi.fn(),
  mockSendCtaUrl: vi.fn(),
}))

vi.mock('../../../lib/whatsapp', () => ({
  sendText: mockSendText,
  sendCustomerMatchFoundNotification: vi.fn(),
}))
vi.mock('../../../lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
  sendText: mockSendText,
}))

// ── State resolver ─────────────────────────────────────────────────────────────
describe('CLIENT-06: status screen resolution', () => {
  it('PENDING_VALIDATION maps to request_submitted screen', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'PENDING_VALIDATION' })
    expect(result.screen).toBe('request_submitted')
    expect(result.reason).toBe('request_awaiting_matching_mode')
  })

  it('OPEN maps to matching_progress screen', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'OPEN' })
    expect(result.screen).toBe('matching_progress')
    expect(result.reason).toBe('request_open_matching_can_start')
  })

  it('MATCHING maps to providers_reviewing screen', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'MATCHING' })
    expect(result.screen).toBe('providers_reviewing')
    expect(result.reason).toBe('providers_reviewing_request')
  })

  it('SHORTLIST_READY maps to shortlist screen', async () => {
    const { resolveClientPwaScreenForState } = await import('../../../lib/client-pwa-state')
    const result = resolveClientPwaScreenForState({ requestStatus: 'SHORTLIST_READY' })
    expect(result.screen).toBe('shortlist')
  })

  it('allowed actions for request_submitted include matching-mode choice and cancel_request', async () => {
    const { allowedActionsForClientPwaScreen } = await import('../../../lib/client-pwa-state')
    const actions = allowedActionsForClientPwaScreen('request_submitted')
    expect(actions).toContain('choose_matching_mode')
    expect(actions).toContain('view_matching_status')
    expect(actions).toContain('cancel_request')
  })

  it('allowed actions for matching_progress include view_matching_status', async () => {
    const { allowedActionsForClientPwaScreen } = await import('../../../lib/client-pwa-state')
    const actions = allowedActionsForClientPwaScreen('matching_progress')
    expect(actions).toContain('view_matching_status')
  })

  it('allowed actions for providers_reviewing include cancel_request but not select_provider', async () => {
    const { allowedActionsForClientPwaScreen } = await import('../../../lib/client-pwa-state')
    const actions = allowedActionsForClientPwaScreen('providers_reviewing')
    expect(actions).toContain('cancel_request')
    expect(actions).not.toContain('select_provider')
  })
})

describe('CLIENT-06: token request-submitted page', () => {
  it('offers matching-mode actions instead of passive provider search copy', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/requests/access/[token]/page.tsx'),
      'utf8',
    )
    expect(source).toContain('chooseMatchingModeFromToken')
    expect(source).toContain('name="mode" value="quick_match"')
    expect(source).toContain('name="mode" value="review_first"')
    expect(source).toContain('Choose how you&apos;d like to find a provider.')
    expect(source).not.toContain('We&apos;re checking suitable providers in your area.</p>')
  })

  it('hides matching-mode choices once Review Providers First has candidates', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/requests/access/[token]/page.tsx'),
      'utf8',
    )
    expect(source).toContain("destination.screen === 'request_submitted' && !isReviewFirstFlow")
    expect(source).toContain('<Badge variant="brand">Review providers</Badge>')
  })

  it('includes safe app navigation and auth-aware bottom nav on ticket page', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/requests/access/[token]/page.tsx'),
      'utf8',
    )
    expect(source).toContain('Back to bookings')
    expect(source).toContain('Back to home')
    expect(source).toContain('Your bookings')
    expect(source).toContain('<BottomNav')
    expect(source).toContain("authState: isAuthenticated ? 'authenticated' : 'anonymous'")
    expect(source).toContain('const source = resolveRequestTicketSource')
  })
})

// ── Submission notification ───────────────────────────────────────────────────
describe('CLIENT-06: submission WhatsApp notification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends request submitted message with category and area', async () => {
    mockSendText.mockResolvedValue('wamid-sub')
    mockSendCtaUrl.mockResolvedValue('wamid-cta')

    const { notifyCustomerPwaRequestSubmitted } = await import(
      '../../../lib/client-pwa-submission-notifications'
    )
    const result = await notifyCustomerPwaRequestSubmitted({
      customerPhone: '+27821234567',
      category: 'electrical',
      suburb: 'bryanston',
      city: 'johannesburg',
      ticketUrl: 'https://app.plugapro.co.za/requests/access/tok',
      requestId: 'req-sub-1',
    })

    expect(result.sent).toBe(true)
    const textBody: string = mockSendText.mock.calls[0][0].text
    expect(textBody).toContain('Request submitted')
    expect(textBody).toContain('electrical')
    expect(textBody).toContain('Choose how you\'d like to find a provider')
    // URL not inlined in text body
    expect(textBody).not.toContain('https://')
  })

  it('returns sent:false without throwing when phone is null', async () => {
    const { notifyCustomerPwaRequestSubmitted } = await import(
      '../../../lib/client-pwa-submission-notifications'
    )
    const result = await notifyCustomerPwaRequestSubmitted({
      customerPhone: null,
      category: 'plumbing',
      suburb: 'sandton',
      city: 'johannesburg',
      ticketUrl: null,
      requestId: 'req-sub-2',
    })

    expect(result).toEqual({ sent: false, reason: 'no_customer_phone' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('omits area clause when suburb and city are null', async () => {
    mockSendText.mockResolvedValue('wamid-sub2')
    mockSendCtaUrl.mockResolvedValue('wamid-cta2')

    const { notifyCustomerPwaRequestSubmitted } = await import(
      '../../../lib/client-pwa-submission-notifications'
    )
    await notifyCustomerPwaRequestSubmitted({
      customerPhone: '+27821234567',
      category: 'plumbing',
      suburb: null,
      city: null,
      ticketUrl: null,
      requestId: 'req-sub-3',
    })

    const text: string = mockSendText.mock.calls[0][0].text
    // When area is null there should be no trailing comma or "in" clause
    expect(text).not.toMatch(/in ,/)
    expect(text).not.toMatch(/request in\.$/)
  })
})

// ── Matching-in-progress notification ────────────────────────────────────────
describe('CLIENT-06: matching-in-progress WhatsApp notification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends matching-in-progress message when not already sent', async () => {
    mockSendText.mockResolvedValue('wamid-match')
    const { notifyCustomerMatchingInProgress } = await import(
      '../../../lib/client-pwa-submission-notifications'
    )
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: '+27821234567',
      category: 'plumbing',
      requestId: 'req-m1',
      isAlreadySent: false,
    })
    expect(result.sent).toBe(true)
    const text: string = mockSendText.mock.calls[0][0].text
    expect(text).toContain('Quick Match in progress')
    expect(text).toContain("we'll try the next suitable provider")
  })

  it('is idempotent — skips send when isAlreadySent is true', async () => {
    const { notifyCustomerMatchingInProgress } = await import(
      '../../../lib/client-pwa-submission-notifications'
    )
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: '+27821234567',
      category: 'plumbing',
      requestId: 'req-m2',
      isAlreadySent: true,
    })
    expect(result).toEqual({ sent: false, reason: 'already_sent' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('returns sent:false without throwing on WhatsApp failure', async () => {
    mockSendText.mockRejectedValue(new Error('503 Service Unavailable'))
    const { notifyCustomerMatchingInProgress } = await import(
      '../../../lib/client-pwa-submission-notifications'
    )
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: '+27821234567',
      category: 'electrical',
      requestId: 'req-m3',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toContain('503')
  })
})

// ── DuplicateActiveRequestError ───────────────────────────────────────────────
describe('CLIENT-06: DuplicateActiveRequestError', () => {
  it('has correct name and preserves existingId, customerId, existingStatus', async () => {
    const { DuplicateActiveRequestError } = await import(
      '../../../lib/job-requests/create-job-request'
    )
    const err = new DuplicateActiveRequestError('req-dup-1', 'cust-1', 'OPEN', 'Leaking tap')
    expect(err.name).toBe('DuplicateActiveRequestError')
    expect(err.message).toBe('DUPLICATE_ACTIVE_REQUEST')
    expect(err.existingId).toBe('req-dup-1')
    expect(err.customerId).toBe('cust-1')
    expect(err.existingStatus).toBe('OPEN')
    expect(err instanceof Error).toBe(true)
  })

  it('is distinguishable via instanceof check', async () => {
    const { DuplicateActiveRequestError } = await import(
      '../../../lib/job-requests/create-job-request'
    )
    const err = new DuplicateActiveRequestError('r', 'c', 'MATCHING', '')
    expect(err instanceof DuplicateActiveRequestError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })
})
