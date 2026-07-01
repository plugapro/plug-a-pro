import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/internal-test-cohort', () => ({
  isCohortMismatch: vi.fn().mockReturnValue(false),
  isInternalTestPhone: vi.fn().mockReturnValue(false),
}))

import { sendButtons } from '@/lib/whatsapp-interactive'

// Meta rejects interactive quick-reply button titles over 20 characters with
// error #131009 AFTER the message is accepted locally — the send just fails in
// production (seen 2026-07-01 on the registration welcome step). This guard
// makes the failure loud at send time, mirroring the raw-URL guard.

describe('central WhatsApp quick-reply button title guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WHATSAPP_ACCESS_TOKEN = 'token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test' }] }),
    }) as never
  })

  it('blocks quick-reply titles longer than 20 characters before sending', async () => {
    await expect(
      sendButtons('+27711111111', 'Pick an option', [
        { id: 'ok', title: 'This title is far too long' },
      ]),
    ).rejects.toThrow(/button title.*20/i)

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('allows titles at exactly 20 characters', async () => {
    await expect(
      sendButtons('+27711111111', 'Pick an option', [
        { id: 'ok', title: 'Continue application' }, // exactly 20
        { id: 'home', title: '🏠 Main Menu' },
      ]),
    ).resolves.toBe('wamid.test')

    expect(global.fetch).toHaveBeenCalledOnce()
  })
})

describe('known quick-reply title regressions stay fixed', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', '..', rel), 'utf8')

  it('whatsapp-bot resume prompts no longer use the 22-char "▶️ Continue application" title', () => {
    expect(read('lib/whatsapp-bot.ts')).not.toContain("title: '▶️ Continue application'")
  })

  it('registration name shortcut no longer uses the 25-char "✏️ Enter a different name" title', () => {
    expect(read('lib/whatsapp-flows/registration.ts')).not.toContain(
      "title: '✏️ Enter a different name'",
    )
  })
})
