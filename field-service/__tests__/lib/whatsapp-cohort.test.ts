import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('WhatsApp template cohort guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone-number-id')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.1' }] }),
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses explicit DB recipientIsTest metadata instead of phone-list guessing', async () => {
    const { sendTemplate } = await import('@/lib/whatsapp')

    await expect(sendTemplate({
      to: '+27821234567',
      template: 'booking_confirmation',
      metadata: { isTestRequest: true, recipientIsTest: true },
    })).resolves.toBe('wamid.1')

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('blocks when explicit recipientIsTest disagrees with the subject cohort', async () => {
    const { sendTemplate } = await import('@/lib/whatsapp')

    await expect(sendTemplate({
      to: '+27821234567',
      template: 'booking_confirmation',
      metadata: { isTestRequest: true, recipientIsTest: false },
    })).rejects.toThrow('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')

    expect(fetch).not.toHaveBeenCalled()
  })
})
