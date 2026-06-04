// ─── Evidence prompt: Skip-primary reorder (Workstream C.2) ──────────────────
// When the whatsapp.registration.evidence_skip_primary flag is enabled, the
// non-high-risk evidence prompt shows "Skip for now" as the first button.

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

import { sendEvidencePrompt } from '@/lib/whatsapp-flows/registration'
import { sendButtons } from '@/lib/whatsapp-interactive'

const sendButtonsMock = vi.mocked(sendButtons)

describe('evidence prompt (non-high-risk path)', () => {
  beforeEach(() => sendButtonsMock.mockClear())

  it('lists Skip for now as the first button when flag is enabled', async () => {
    await sendEvidencePrompt('+27820000002', { skills: ['plumbing'] }, {})
    const [, , buttons] = sendButtonsMock.mock.calls[0]
    expect(buttons[0].id).toBe('evidence_skip')
    expect(buttons[0].title).toMatch(/skip/i)
  })

  it('keeps Add proof note as a secondary option', async () => {
    await sendEvidencePrompt('+27820000002', { skills: ['plumbing'] }, {})
    const [, , buttons] = sendButtonsMock.mock.calls[0]
    expect(buttons.find((b: { id: string }) => b.id === 'evidence_add')).toBeDefined()
  })

  it('reframes the prompt copy to invite skipping', async () => {
    await sendEvidencePrompt('+27820000002', { skills: ['plumbing'] }, {})
    const [, body] = sendButtonsMock.mock.calls[0]
    expect(body).toMatch(/skip/i)
  })
})
