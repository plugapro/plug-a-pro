import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runDraftAbandonmentNudge, selectionWhere } from '@/lib/provider-registration/abandonment-nudge'
import { assertNoRawUrlsInWhatsAppBody } from '@/lib/whatsapp-copy'

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

  it('claims, sends the template with name param + URL button token suffix, finalizes, audits', async () => {
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
            type: 'body',
            parameters: [{ type: 'text', text: 'Thabo' }],
          }),
          expect.objectContaining({
            type: 'button',
            sub_type: 'url',
            index: 0,
            parameters: [{ type: 'text', text: 'tok123' }],
          }),
        ],
      }),
    )
    expect(d.db.auditLog.create).toHaveBeenCalled()
  })

  it('never puts the resume URL/token in a body or header text parameter (Critical 1 regression guard)', async () => {
    const d = deps()
    await runDraftAbandonmentNudge(d)
    const call = d.sendTemplate.mock.calls[0][0]
    const bodyOrHeaderComponents = call.components.filter((c: any) => c.type === 'body' || c.type === 'header')
    for (const component of bodyOrHeaderComponents) {
      for (const param of component.parameters) {
        if (param.type !== 'text') continue
        expect(param.text).not.toMatch(/https?:\/\//)
        expect(param.text).not.toContain('tok123')
      }
    }
  })

  it('the built components pass the REAL raw-url guard (proves the fix has teeth)', async () => {
    const d = deps()
    await runDraftAbandonmentNudge(d)
    const call = d.sendTemplate.mock.calls[0][0]
    for (const component of call.components) {
      if (component.type !== 'body' && component.type !== 'header') continue
      component.parameters.forEach((parameter: any, index: number) => {
        if (parameter.type !== 'text') return
        expect(() =>
          assertNoRawUrlsInWhatsAppBody(parameter.text, `provider_registration_resume_nudge:${component.type}:${index}`),
        ).not.toThrow()
      })
    }
  })

  it('proves the guard has teeth: the OLD url-in-body shape would have failed it', () => {
    expect(() =>
      assertNoRawUrlsInWhatsAppBody(
        'https://plugapro.co.za/provider/register?resume=tok123',
        'provider_registration_resume_nudge:body:1',
      ),
    ).toThrow()
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

  it('the claim is a true compare-and-set: guards on id, nudgeCount, lastNudgeAt, and submittedApplicationId', async () => {
    const d = deps()
    await runDraftAbandonmentNudge(d)
    const claimCall = d.db.providerApplicationDraft.updateMany.mock.calls[0][0]
    expect(claimCall.where).toEqual(
      expect.objectContaining({
        id: 'd1',
        nudgeCount: 0,
        lastNudgeAt: null,
        submittedApplicationId: null,
      }),
    )
    expect(claimCall.data).toEqual(expect.objectContaining({ lastNudgeAt: NOW }))
  })

  it('closes the double-send race: a second overlapping run whose claim lands second (updateMany count 0) sends nothing', async () => {
    // Simulate two overlapping cron instances racing the same draft. Both read
    // the same candidate (nudgeCount 0, lastNudgeAt null). Instance A's claim
    // updateMany succeeds (count 1); instance B's claim updateMany, guarded on
    // the same lastNudgeAt: null precondition, must return count 0 because A
    // already moved lastNudgeAt off null.
    const sharedDraft = {
      id: 'd1', phone: '+27821234567', name: 'Thabo M', nudgeCount: 0,
      lastNudgeAt: null, updatedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      identityVerifications: [],
    }

    // --- Instance A: claim succeeds and completes the send ---
    const depsA = deps()
    depsA.db.providerApplicationDraft.findMany.mockResolvedValue([sharedDraft])
    const resultA = await runDraftAbandonmentNudge(depsA)
    expect(resultA.sent).toBe(1)

    // --- Instance B: same candidate, but its claim's compare-and-set no
    // longer matches (A already wrote lastNudgeAt) so the fake db returns
    // count 0 as Prisma would for a real CAS miss ---
    const depsB = deps()
    depsB.db.providerApplicationDraft.findMany.mockResolvedValue([sharedDraft])
    depsB.db.providerApplicationDraft.updateMany.mockResolvedValue({ count: 0 })
    const resultB = await runDraftAbandonmentNudge(depsB)
    expect(resultB.sent).toBe(0)
    expect(resultB.skipped).toBe(1)
    expect(depsB.sendTemplate).not.toHaveBeenCalled()
  })

  it('extends the lost-claim test: verifies the CAS where-clause carries lastNudgeAt even on a non-null prior value', async () => {
    const d = deps()
    const secondTouchDraft = {
      id: 'd2', phone: '+27821234568', name: 'Sipho N', nudgeCount: 1,
      lastNudgeAt: new Date(NOW.getTime() - 21 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      identityVerifications: [],
    }
    d.db.providerApplicationDraft.findMany.mockResolvedValue([secondTouchDraft])
    d.db.providerApplicationDraft.updateMany.mockResolvedValue({ count: 0 })
    const result = await runDraftAbandonmentNudge(d)
    expect(result.skipped).toBe(1)
    expect(d.sendTemplate).not.toHaveBeenCalled()
    const claimCall = d.db.providerApplicationDraft.updateMany.mock.calls[0][0]
    expect(claimCall.where).toEqual(
      expect.objectContaining({
        id: 'd2',
        nudgeCount: 1,
        lastNudgeAt: secondTouchDraft.lastNudgeAt,
        submittedApplicationId: null,
      }),
    )
  })

  it('sets updatedAt explicitly on the claim write (belt-and-braces self-heal, Important 1)', async () => {
    const d = deps()
    await runDraftAbandonmentNudge(d)
    const claimCall = d.db.providerApplicationDraft.updateMany.mock.calls[0][0]
    expect(claimCall.data).toEqual(expect.objectContaining({ updatedAt: NOW }))
  })

  it('writes an "attempted" AuditLog row BEFORE calling sendTemplate (Important 2)', async () => {
    const callOrder: string[] = []
    const d = deps()
    d.db.auditLog.create.mockImplementation((args: any) => {
      callOrder.push(args.data.action)
      return Promise.resolve({})
    })
    d.sendTemplate.mockImplementation(() => {
      callOrder.push('sendTemplate')
      return Promise.resolve('wamid.1')
    })
    await runDraftAbandonmentNudge(d)
    expect(callOrder).toEqual([
      'draft.abandonment_nudge_attempted',
      'sendTemplate',
      'draft.abandonment_nudge_sent',
    ])
    expect(d.db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'draft.abandonment_nudge_attempted',
          entityType: 'ProviderApplicationDraft',
          entityId: 'd1',
        }),
      }),
    )
  })

  it('the "attempted" AuditLog row is present even when send fails, but "sent" is not written', async () => {
    const d = deps({ sendTemplate: vi.fn().mockRejectedValue(new Error('meta down')) })
    const result = await runDraftAbandonmentNudge(d)
    expect(result.errors).toBe(1)
    const actions = d.db.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action)
    expect(actions).toContain('draft.abandonment_nudge_attempted')
    expect(actions).not.toContain('draft.abandonment_nudge_sent')
  })

  it('the "sent" AuditLog row is written only on a confirmed success', async () => {
    const d = deps()
    await runDraftAbandonmentNudge(d)
    const actions = d.db.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action)
    expect(actions).toContain('draft.abandonment_nudge_sent')
    expect(actions.filter((a: string) => a === 'draft.abandonment_nudge_sent')).toHaveLength(1)
  })
})
