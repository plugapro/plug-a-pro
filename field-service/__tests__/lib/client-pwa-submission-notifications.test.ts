import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendText, mockSendCtaUrl } = vi.hoisted(() => ({
  mockSendText: vi.fn(),
  mockSendCtaUrl: vi.fn(),
}))

vi.mock('../../lib/whatsapp', () => ({
  sendText: mockSendText,
}))

vi.mock('../../lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
}))

describe('client PWA submission notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends WhatsApp confirmation with ticket link and matching-mode prompt', async () => {
    mockSendText.mockResolvedValue('wamid-1')
    mockSendCtaUrl.mockResolvedValue('wamid-cta')

    const { notifyCustomerPwaRequestSubmitted } = await import('../../lib/client-pwa-submission-notifications')
    const result = await notifyCustomerPwaRequestSubmitted({
      customerPhone: '+27821234567',
      category: 'plumbing',
      suburb: 'sandton',
      city: 'johannesburg',
      ticketUrl: 'https://app.plugapro.co.za/requests/access/token',
      requestId: 'request-1',
    })

    expect(result).toEqual({ sent: true })
    expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27821234567',
      templateName: 'interactive:client_pwa_request_submitted',
      metadata: { requestId: 'request-1' },
    }))
    expect(mockSendText.mock.calls[0][0].text).toContain('Choose how you\'d like to find a provider')
    expect(mockSendText.mock.calls[0][0].text).not.toContain('https://')
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27821234567',
      'Your request tracker is available below.',
      'View request',
      'https://app.plugapro.co.za/requests/access/token',
      undefined,
      expect.any(Object),
    )
  })
})

describe('notifyCustomerMatchingInProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends matching-in-progress WhatsApp message when no prior CW2 has been sent', async () => {
    mockSendText.mockResolvedValue('wamid-matching')

    const { notifyCustomerMatchingInProgress } = await import('../../lib/client-pwa-submission-notifications')
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: '+27821234567',
      category: 'plumbing',
      requestId: 'request-2',
      isAlreadySent: false,
    })

    expect(result).toEqual({ sent: true })
    expect(mockSendText).toHaveBeenCalledOnce()
    const call = mockSendText.mock.calls[0][0]
    expect(call.to).toBe('+27821234567')
    expect(call.templateName).toBe('interactive:client_matching_in_progress')
    expect(call.text).toContain('Quick Match in progress')
    expect(call.text).toContain("we'll try the next suitable provider")
    expect(call.text).not.toContain('https://')
    expect(call.metadata).toEqual({ requestId: 'request-2' })
  })

  it('skips send when isAlreadySent is true (idempotency guard)', async () => {
    const { notifyCustomerMatchingInProgress } = await import('../../lib/client-pwa-submission-notifications')
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: '+27821234567',
      category: 'plumbing',
      requestId: 'request-2',
      isAlreadySent: true,
    })

    expect(result).toEqual({ sent: false, reason: 'already_sent' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('returns sent:false without throwing when customerPhone is null', async () => {
    const { notifyCustomerMatchingInProgress } = await import('../../lib/client-pwa-submission-notifications')
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: null,
      category: 'plumbing',
      requestId: 'request-3',
    })

    expect(result).toEqual({ sent: false, reason: 'no_customer_phone' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('returns sent:false without throwing when WhatsApp send fails', async () => {
    mockSendText.mockRejectedValue(new Error('WhatsApp API unavailable'))

    const { notifyCustomerMatchingInProgress } = await import('../../lib/client-pwa-submission-notifications')
    const result = await notifyCustomerMatchingInProgress({
      customerPhone: '+27821234567',
      category: 'electrical',
      requestId: 'request-4',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('WhatsApp API unavailable')
  })
})
