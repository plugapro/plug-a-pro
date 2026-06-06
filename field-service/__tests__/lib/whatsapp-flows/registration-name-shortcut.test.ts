// ─── reg_collect_name profile-name shortcut (Workstream A.4) ─────────────────
// When the whatsapp.registration.name_profile_shortcut flag is enabled and
// the WhatsApp profile name is available on the inbound payload, the bot
// offers a one-tap "Use <WA name>" button instead of asking for free text.
//
// Critical contract: the offered name is persisted into ctx.data.proposedName
// when the buttons are shown, so the subsequent button-tap webhook (which
// Meta delivers WITHOUT the contacts payload) can recover it.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { conversation: { findUnique: vi.fn().mockResolvedValue({ data: {} }) } },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags')
  return { ...actual, isEnabled: vi.fn().mockResolvedValue(true) }
})

import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'
import { sendText, sendButtons } from '@/lib/whatsapp-interactive'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

const sendTextMock = vi.mocked(sendText)
const sendButtonsMock = vi.mocked(sendButtons)

function ctx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    phone: '+27820000001',
    step: 'reg_collect_name',
    flow: 'registration',
    reply: { type: 'button_reply', text: '', id: 'reg_start' },
    data: {},
    senderProfileName: 'Lebogang Mafoko',
    ...overrides,
  } as FlowContext
}

describe('reg_collect_name profile-name shortcut', () => {
  beforeEach(() => {
    sendTextMock.mockClear()
    sendButtonsMock.mockClear()
  })

  it('offers the WhatsApp profile name as a one-tap button when available and flag enabled', async () => {
    await handleRegistrationFlow(ctx())
    expect(sendButtonsMock).toHaveBeenCalledTimes(1)
    const [phone, body, buttons] = sendButtonsMock.mock.calls[0]
    expect(phone).toBe('+27820000001')
    expect(body).toMatch(/only use this/i) // privacy framing line
    expect(buttons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'name_use_wa', title: expect.stringContaining('Lebogang') }),
        expect.objectContaining({ id: 'name_enter_different', title: expect.stringMatching(/different/i) }),
      ]),
    )
  })

  it('persists the offered name into ctx.data.proposedName so the button tap can recover it', async () => {
    const result = await handleRegistrationFlow(ctx())
    expect(result.nextStep).toBe('reg_collect_skills')
    expect(result.nextData?.proposedName).toBe('Lebogang Mafoko')
  })

  it('caps the button title at WhatsApp\'s 20-char interactive button limit', async () => {
    await handleRegistrationFlow(ctx({ senderProfileName: 'Thandolwethu Mokoena' }))
    const [, , buttons] = sendButtonsMock.mock.calls[0]
    const useButton = buttons.find((b: { id: string }) => b.id === 'name_use_wa')
    expect(useButton).toBeDefined()
    expect(useButton!.title.length).toBeLessThanOrEqual(20)
  })

  it('falls back to the legacy text prompt when no profile name is available', async () => {
    await handleRegistrationFlow(ctx({ senderProfileName: undefined }))
    expect(sendTextMock).toHaveBeenCalledWith('+27820000001', expect.stringMatching(/name/i))
    expect(sendButtonsMock).not.toHaveBeenCalled()
  })

  it('recovers the proposed name from ctx.data when name_use_wa is tapped (button-reply has no senderProfileName)', async () => {
    const result = await handleRegistrationFlow(
      ctx({
        step: 'reg_collect_skills',
        reply: { type: 'button_reply', text: '', id: 'name_use_wa' },
        data: { proposedName: 'Lebogang Mafoko' },
        senderProfileName: undefined, // simulates Meta omitting contacts on button-reply delivery
      }),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData?.name).toBe('Lebogang Mafoko')
  })

  it('also accepts senderProfileName as a fallback when proposedName is somehow absent', async () => {
    const result = await handleRegistrationFlow(
      ctx({
        step: 'reg_collect_skills',
        reply: { type: 'button_reply', text: '', id: 'name_use_wa' },
        senderProfileName: 'Lebogang Mafoko',
      }),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData?.name).toBe('Lebogang Mafoko')
  })

  it('falls back to the full-name prompt when name_use_wa is tapped but no name source is available', async () => {
    const result = await handleRegistrationFlow(
      ctx({
        step: 'reg_collect_skills',
        reply: { type: 'button_reply', text: '', id: 'name_use_wa' },
        data: {},
        senderProfileName: undefined,
      }),
    )
    expect(result.nextStep).toBe('reg_collect_skills')
    expect(sendTextMock).toHaveBeenCalledWith('+27820000001', expect.stringMatching(/full name/i))
  })

  it('re-prompts with the full-name format when name_enter_different is tapped (so the user knows the constraint)', async () => {
    const result = await handleRegistrationFlow(
      ctx({
        step: 'reg_collect_skills',
        reply: { type: 'button_reply', text: '', id: 'name_enter_different' },
      }),
    )
    expect(result.nextStep).toBe('reg_collect_skills')
    expect(sendTextMock).toHaveBeenCalledWith('+27820000001', expect.stringMatching(/full name/i))
  })
})
