import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/internal-test-cohort', () => ({
  isCohortMismatch: vi.fn().mockReturnValue(false),
  isInternalTestPhone: vi.fn().mockReturnValue(false),
}))

import { sendText, sendCtaUrl } from '@/lib/whatsapp-interactive'

describe('central WhatsApp send raw URL guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WHATSAPP_ACCESS_TOKEN = 'token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test' }] }),
    }) as never
  })

  it('blocks raw URLs in visible text bodies before sending', async () => {
    await expect(
      sendText('+27711111111', 'Credit history: https://app.plugapro.co.za/provider/credits'),
    ).rejects.toThrow(/raw URL/)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('allows URLs in CTA payloads when the visible body is clean', async () => {
    await expect(
      sendCtaUrl(
        '+27711111111',
        'Credit history is available below.',
        'View credit history',
        'https://app.plugapro.co.za/provider/credits',
      ),
    ).resolves.toBe('wamid.test')

    expect(global.fetch).toHaveBeenCalledOnce()
  })
})
