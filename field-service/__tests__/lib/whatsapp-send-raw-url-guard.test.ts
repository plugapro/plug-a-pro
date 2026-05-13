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
      sendText('+27711111111', 'Credits history: https://app.plugapro.co.za/provider/credits'),
    ).rejects.toThrow(/raw URL/)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('allows URLs in CTA payloads when the visible body is clean', async () => {
    await expect(
      sendCtaUrl(
        '+27711111111',
        'Credits history is available below.',
        'View credits history',
        'https://app.plugapro.co.za/provider/credits',
      ),
    ).resolves.toBe('wamid.test')

    expect(global.fetch).toHaveBeenCalledOnce()
  })

  it('sends provider lead offers with the signed URL only in a CTA button payload', async () => {
    const { sendJobOffer } = await import('@/lib/whatsapp')

    await sendJobOffer({
      providerPhone: '+27711111111',
      providerFirstName: 'Lovemore',
      serviceName: 'DIY & Assembly',
      area: 'Bromhof, Johannesburg',
      scheduledWindow: 'This week',
      jobUrl: 'https://app.plugapro.co.za/leads/access/signed-token',
    })

    expect(global.fetch).toHaveBeenCalledOnce()
    const body = JSON.parse(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body))
    expect(body.template.name).toBe('provider_lead_offer')
    const bodyComponent = body.template.components.find((component: { type: string }) => component.type === 'body')
    const buttonComponent = body.template.components.find((component: { type: string; sub_type?: string }) =>
      component.type === 'button' && component.sub_type === 'url'
    )
    const bodyText = JSON.stringify(bodyComponent)

    expect(bodyText).not.toContain('https://')
    expect(bodyText).not.toContain('app.plugapro.co.za')
    expect(bodyText).not.toContain('/leads/access')
    expect(bodyComponent.parameters).toEqual([
      { type: 'text', text: 'Lovemore' },
      { type: 'text', text: 'DIY & Assembly' },
      { type: 'text', text: 'Bromhof, Johannesburg' },
      { type: 'text', text: 'This week' },
    ])
    expect(buttonComponent.parameters).toEqual([
      { type: 'text', text: 'signed-token' },
    ])
  })
})
