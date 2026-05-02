import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendText } = vi.hoisted(() => ({
  mockSendText: vi.fn(),
}))

vi.mock('../../lib/whatsapp', () => ({
  sendText: mockSendText,
}))

describe('client PWA submission notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends WhatsApp confirmation with ticket link and shortlist expectation', async () => {
    mockSendText.mockResolvedValue('wamid-1')

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
    expect(mockSendText.mock.calls[0][0].text).toContain("We'll notify you when your shortlist is ready.")
    expect(mockSendText.mock.calls[0][0].text).toContain('https://app.plugapro.co.za/requests/access/token')
  })
})
