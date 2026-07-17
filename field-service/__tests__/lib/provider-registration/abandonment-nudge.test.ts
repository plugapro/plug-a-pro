import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runDraftAbandonmentNudge, selectionWhere } from '@/lib/provider-registration/abandonment-nudge'

const NOW = new Date('2026-07-17T10:00:00Z')

function deps(overrides: Record<string, any> = {}) {
  const draft = {
    id: 'd1', phone: '+27821234567', name: 'Thabo M', nudgeCount: 0,
    lastNudgeAt: null, updatedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    identityVerifications: [],
  }
  return {
    now: () => NOW,
    db: {
      providerApplicationDraft: {
        findMany: vi.fn().mockResolvedValue([draft]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customer: { findFirst: vi.fn().mockResolvedValue(null) },
      provider: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    },
    findActiveApplication: vi.fn().mockResolvedValue(null),
    mintResumeToken: vi.fn().mockResolvedValue('tok123'),
    sendTemplate: vi.fn().mockResolvedValue('wamid.1'),
    flagEnabled: vi.fn().mockResolvedValue(true),
    publicUrl: (path: string) => `https://plugapro.co.za${path}`,
    ...overrides,
  } as any
}

describe('selectionWhere', () => {
  it('encodes both touch windows and the cap', () => {
    const where = selectionWhere(NOW)
    expect(where.submittedApplicationId).toBeNull()
    expect(where.OR).toHaveLength(2)
    expect(where.OR[0]).toMatchObject({ nudgeCount: 0 })
    expect(where.OR[1]).toMatchObject({ nudgeCount: 1 })
  })
})

describe('runDraftAbandonmentNudge', () => {
  it('does nothing when the flag is off', async () => {
    const d = deps({ flagEnabled: vi.fn().mockResolvedValue(false) })
    const result = await runDraftAbandonmentNudge(d)
    expect(result).toEqual({ found: 0, sent: 0, skipped: 0, errors: 0 })
    expect(d.db.providerApplicationDraft.findMany).not.toHaveBeenCalled()
  })

  it('claims, sends the template with name + resume url, finalizes, audits', async () => {
    const d = deps()
    const result = await runDraftAbandonmentNudge(d)
    expect(result.sent).toBe(1)
    // atomic claim: conditional updateMany on unchanged nudgeCount
    expect(d.db.providerApplicationDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'd1', nudgeCount: 0 }) }),
    )
    expect(d.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+27821234567',
        template: 'provider_registration_resume_nudge',
        components: [
          expect.objectContaining({
            parameters: [
              { type: 'text', text: 'Thabo' },
              { type: 'text', text: 'https://plugapro.co.za/provider/register?resume=tok123' },
            ],
          }),
        ],
      }),
    )
    expect(d.db.auditLog.create).toHaveBeenCalled()
  })

  it('skips drafts whose phone has an active application', async () => {
    const d = deps({ findActiveApplication: vi.fn().mockResolvedValue({ id: 'app1', status: 'PENDING' }) })
    const result = await runDraftAbandonmentNudge(d)
    expect(result.skipped).toBe(1)
    expect(d.sendTemplate).not.toHaveBeenCalled()
  })

  it('skips drafts holding a non-terminal verification (in-flight-renudge owns them)', async () => {
    const d = deps()
    d.db.providerApplicationDraft.findMany.mockResolvedValue([
      { id: 'd2', phone: '+27820000001', name: null, nudgeCount: 0, lastNudgeAt: null,
        updatedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        identityVerifications: [{ id: 'v1', status: 'AWAITING_LIVENESS' }] },
    ])
    const result = await runDraftAbandonmentNudge(d)
    expect(result.skipped).toBe(1)
    expect(d.sendTemplate).not.toHaveBeenCalled()
  })

  it('does not increment nudgeCount when the send fails', async () => {
    const d = deps({ sendTemplate: vi.fn().mockRejectedValue(new Error('meta down')) })
    const result = await runDraftAbandonmentNudge(d)
    expect(result.errors).toBe(1)
    // finalize call (nudgeCount increment) must NOT have happened; claim release must
    const calls = d.db.providerApplicationDraft.updateMany.mock.calls.map((c: any[]) => c[0])
    expect(calls.some((c: any) => c.data?.nudgeCount !== undefined && c.data?.nudgeCount?.increment === 1)).toBe(false)
  })

  it('lost claim (updateMany count 0) is skipped silently', async () => {
    const d = deps()
    d.db.providerApplicationDraft.updateMany.mockResolvedValue({ count: 0 })
    const result = await runDraftAbandonmentNudge(d)
    expect(result.skipped).toBe(1)
    expect(d.sendTemplate).not.toHaveBeenCalled()
  })
})
