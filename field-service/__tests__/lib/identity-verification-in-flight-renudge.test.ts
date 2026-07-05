import { describe, expect, it, vi } from 'vitest'

import {
  IN_FLIGHT_DEDUP_HOURS,
  IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION,
  IN_FLIGHT_NUDGE_WINDOW_END_HOURS,
  IN_FLIGHT_NUDGE_WINDOW_START_HOURS,
  listInFlightRenudgeCandidates,
  resolveBatchCap,
  sendInFlightRenudges,
  summarizeInFlightRenudgeRows,
  templateForStatus,
  type InFlightRenudgeClient,
} from '@/lib/identity-verification/in-flight-renudge'

const NOW = new Date('2026-06-28T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

function updatedAtAgo(hoursAgo: number): Date {
  return new Date(NOW.getTime() - hoursAgo * HOUR_MS)
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    providerId: 'p1',
    // Fix D: default to null so existing tests represent provider-anchored rows
    providerApplicationDraftId: null,
    providerApplicationDraft: null,
    status: 'AWAITING_DOCUMENT',
    identityBasis: 'SA_ID',
    updatedAt: updatedAtAgo(24),
    expiresAt: null,
    provider: {
      id: 'p1',
      firstName: 'Thabo',
      name: 'Thabo Nkosi',
      phone: '+27820000001',
      active: true,
    },
    ...overrides,
  }
}

function clientWith(rows: unknown[], events: unknown[] = []): InFlightRenudgeClient {
  return {
    providerIdentityVerification: { findMany: vi.fn().mockResolvedValue(rows) },
    messageEvent: { findMany: vi.fn().mockResolvedValue(events) },
  }
}

describe('templateForStatus', () => {
  it.each([
    ['CONSENTED', 'provider_verification_resume_consent'],
    ['AWAITING_IDENTIFIER', 'provider_verification_resume_consent'],
    ['RETRY_REQUIRED', 'provider_verification_resume_consent'],
    ['AWAITING_DOCUMENT', 'provider_verification_resume_document'],
    ['AWAITING_SELFIE', 'provider_verification_resume_selfie'],
  ])('maps %s to %s', (status, expected) => {
    expect(templateForStatus(status as never)).toBe(expected)
  })

  it.each(['PASSED', 'SUBMITTED', 'EXPIRED', 'REJECTED', 'NOT_STARTED', 'PROCESSING'])(
    'returns null for non-in-flight status %s',
    (status) => {
      expect(templateForStatus(status as never)).toBeNull()
    },
  )
})

describe('resolveBatchCap', () => {
  it.each([
    [undefined, 100],
    ['', 100],
    ['abc', 100],
    // Negative = explicit operator disable, same as '0'. The old coercion made
    // -1 mean "0 sends"; silently flipping it to the default (100) would
    // invert an operator's intent.
    ['-5', 0],
    ['NaN', 100],
    ['0', 0],
    ['1', 1],
    ['250', 250],
  ])('resolveBatchCap(%j) -> %d', (raw, expected) => {
    expect(resolveBatchCap(raw)).toBe(expected)
  })
})

describe('listInFlightRenudgeCandidates', () => {
  it('returns one candidate per in-flight verification with template-by-status mapping', async () => {
    const client = clientWith([
      verification({ id: 'v-consent', providerId: 'p-a', status: 'CONSENTED', provider: { id: 'p-a', firstName: 'Anna', name: 'Anna A', phone: '+27820000001', active: true } }),
      verification({ id: 'v-doc', providerId: 'p-b', status: 'AWAITING_DOCUMENT', identityBasis: 'WORK_PERMIT', provider: { id: 'p-b', firstName: 'Bongi', name: null, phone: '+27820000002', active: true } }),
      verification({ id: 'v-selfie', providerId: 'p-c', status: 'AWAITING_SELFIE', provider: { id: 'p-c', firstName: null, name: 'Carl Carlson', phone: '+27820000003', active: true } }),
    ])
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows.map(r => r.templateName)).toEqual([
      'provider_verification_resume_consent',
      'provider_verification_resume_document',
      'provider_verification_resume_selfie',
    ])
    expect(rows.map(r => r.firstName)).toEqual(['Anna', 'Bongi', 'Carl'])
  })

  it('queries the configured updatedAt window (default 20h-28h)', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      providerIdentityVerification: { findMany },
      messageEvent: { findMany: vi.fn().mockResolvedValue([]) },
    }
    await listInFlightRenudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: { updatedAt: { gte: Date; lte: Date } } }).where
    expect(where.updatedAt.gte.getTime()).toBe(NOW.getTime() - IN_FLIGHT_NUDGE_WINDOW_END_HOURS * HOUR_MS)
    expect(where.updatedAt.lte.getTime()).toBe(NOW.getTime() - IN_FLIGHT_NUDGE_WINDOW_START_HOURS * HOUR_MS)
  })

  it('honours custom window overrides', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      providerIdentityVerification: { findMany },
      messageEvent: { findMany: vi.fn().mockResolvedValue([]) },
    }
    await listInFlightRenudgeCandidates(client, { now: NOW, windowStartHours: 6, windowEndHours: 12 })
    const where = (findMany.mock.calls[0][0] as { where: { updatedAt: { gte: Date; lte: Date } } }).where
    expect(where.updatedAt.gte.getTime()).toBe(NOW.getTime() - 12 * HOUR_MS)
    expect(where.updatedAt.lte.getTime()).toBe(NOW.getTime() - 6 * HOUR_MS)
  })

  it('query uses OR to include both provider-anchored and draft-anchored rows, with active filter in the provider OR arm (Fix D)', async () => {
    // The query was restructured for Fix D. Provider.phone is non-nullable, so a
    // top-level `phone: { not: null }` filter would crash Prisma (PR #151 fix retained).
    // The provider-anchored arm still has `provider: { active: true }`.
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      providerIdentityVerification: { findMany },
      messageEvent: { findMany: vi.fn().mockResolvedValue([]) },
    }
    await listInFlightRenudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: { OR: Array<Record<string, unknown>> } }).where
    // The query must use an OR with at least 2 arms (provider-anchored + draft-anchored)
    expect(Array.isArray(where.OR)).toBe(true)
    // The provider-anchored arm must still filter `provider: { active: true }`
    const providerArm = where.OR.find((arm: Record<string, unknown>) => 'provider' in arm)
    expect(providerArm?.provider).toEqual({ active: true })
    // No top-level `phone: { not: null }` filter (would crash Prisma on non-nullable column)
    expect((where as Record<string, unknown>).phone).toBeUndefined()
  })

  it('drops rows with no linked provider, no phone, or null providerId (no draft either)', async () => {
    const client = clientWith([
      verification({ id: 'v-ok', providerId: 'p-ok', provider: { id: 'p-ok', firstName: 'Ok', name: null, phone: '+27820000001', active: true } }),
      // No provider, no draft → invalid, must be excluded
      verification({ id: 'v-no-provider', provider: null, providerId: null, providerApplicationDraftId: null }),
      // Has provider but no phone → excluded (blank-phone post-query filter)
      verification({ id: 'v-no-phone', providerId: 'p-x', provider: { id: 'p-x', firstName: 'X', name: null, phone: null, active: true } }),
      // providerId null, has provider object but NO draft → neither provider-anchored nor draft-anchored, excluded
      verification({ id: 'v-null-pid', providerId: null, providerApplicationDraftId: null, provider: { id: 'p-y', firstName: 'Y', name: null, phone: '+27820000002', active: true } }),
    ])
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows.map(r => r.verificationId)).toEqual(['v-ok'])
  })

  it('Fix D: includes draft-anchored verifications (no providerId, has draft) as candidates', async () => {
    // Draft-anchored = PWA gate-ON applicant: verification issued against a draft,
    // no Provider row exists yet. These rows should now be picked up by the cron.
    const draftAnchored = verification({
      id: 'v-draft',
      providerId: null,
      providerApplicationDraftId: 'draft-abc',
      providerApplicationDraft: { id: 'draft-abc', phone: '+27820000099', name: 'Draft Applicant' },
      provider: null,
    })
    const providerAnchored = verification({
      id: 'v-prov',
      providerId: 'p-ok',
      provider: { id: 'p-ok', firstName: 'Ok', name: null, phone: '+27820000001', active: true },
    })
    const client = clientWith([draftAnchored, providerAnchored])
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    const ids = rows.map(r => r.verificationId)
    expect(ids).toContain('v-draft')
    expect(ids).toContain('v-prov')
    // Draft-anchored candidate fields
    const draftRow = rows.find(r => r.verificationId === 'v-draft')!
    expect(draftRow.providerId).toBeNull()
    expect(draftRow.draftId).toBe('draft-abc')
    expect(draftRow.phone).toBe('+27820000099')
  })

  it('blocks eligibility when a recent in-flight-resume MessageEvent exists within IN_FLIGHT_DEDUP_HOURS', async () => {
    const recent = new Date(NOW.getTime() - (IN_FLIGHT_DEDUP_HOURS - 2) * HOUR_MS)
    const stale = new Date(NOW.getTime() - (IN_FLIGHT_DEDUP_HOURS + 4) * HOUR_MS)
    const client = clientWith(
      [
        verification({ id: 'v-fresh', providerId: 'p-fresh', provider: { id: 'p-fresh', firstName: 'F', name: null, phone: '+27820000001', active: true } }),
        verification({ id: 'v-recent', providerId: 'p-recent', provider: { id: 'p-recent', firstName: 'R', name: null, phone: '+27820000002', active: true } }),
        verification({ id: 'v-stale', providerId: 'p-stale', provider: { id: 'p-stale', firstName: 'S', name: null, phone: '+27820000003', active: true } }),
      ],
      [
        { to: '+27820000002', templateName: 'provider_verification_resume_consent', createdAt: recent },
        { to: '+27820000003', templateName: 'provider_verification_resume_consent', createdAt: stale },
      ],
    )
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    const byProvider = new Map(rows.map(r => [r.providerId, r]))
    expect(byProvider.get('p-fresh')?.eligibleNow).toBe(true)
    expect(byProvider.get('p-recent')?.eligibleNow).toBe(false)
    expect(byProvider.get('p-stale')?.eligibleNow).toBe(true)
  })

  it('blocks eligibility when the verification is at the lifetime cap regardless of recency', async () => {
    const stale = new Date(NOW.getTime() - 40 * HOUR_MS)
    const client = clientWith(
      [
        verification({ id: 'v', providerId: 'p-capped', provider: { id: 'p-capped', firstName: 'C', name: null, phone: '+27820000001', active: true } }),
      ],
      Array.from({ length: IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION }, (_, i) => ({
        to: '+27820000001',
        templateName: 'provider_verification_resume_consent',
        createdAt: new Date(stale.getTime() - i * 24 * HOUR_MS),
        metadata: { identityInFlightRenudge: true, verificationId: 'v' },
      })),
    )
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows[0].priorSendsForVerification).toBe(IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION)
    expect(rows[0].eligibleNow).toBe(false)
  })

  it('counts the lifetime cap per verification, not per phone: sends for an older verification do not burn a new one', async () => {
    const stale = new Date(NOW.getTime() - 40 * HOUR_MS)
    const client = clientWith(
      [
        verification({ id: 'v-new', providerId: 'p1', provider: { id: 'p1', firstName: 'C', name: null, phone: '+27820000001', active: true } }),
      ],
      Array.from({ length: IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION }, (_, i) => ({
        to: '+27820000001',
        templateName: 'provider_verification_resume_consent',
        createdAt: new Date(stale.getTime() - i * 24 * HOUR_MS),
        metadata: { identityInFlightRenudge: true, verificationId: 'v-old' },
      })),
    )
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows[0].priorSendsForVerification).toBe(0)
    expect(rows[0].eligibleNow).toBe(true)
  })

  it('fetches events of EVERY status with no time bound - FAILED must block the 24h window, and the lifetime cap must be truly lifetime', async () => {
    // Review findings 1+4 (PR #152): a status filter in the query made FAILED
    // attempts free dedup budget (hourly re-send storms), and the 90-day scan
    // cutoff reset the "lifetime" cap for never-expiring verification rows.
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      providerIdentityVerification: {
        findMany: vi.fn().mockResolvedValue([verification()]),
      },
      messageEvent: { findMany },
    }
    await listInFlightRenudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where.status).toBeUndefined()
    expect(where.createdAt).toBeUndefined()
  })

  it('a FAILED attempt within 24h still blocks re-sending (retry floor), but does NOT consume the lifetime cap', async () => {
    const failedRecent = {
      to: '+27820000001',
      templateName: 'provider_verification_resume_document',
      createdAt: new Date(NOW.getTime() - 2 * HOUR_MS),
      status: 'FAILED',
      metadata: { verificationId: 'v1' },
    }
    const client = clientWith([verification()], [failedRecent])
    const [candidate] = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(candidate.eligibleNow).toBe(false) // 24h floor holds even for failures
    expect(candidate.priorSendsForVerification).toBe(0) // cap budget preserved
  })

  it('a FAILED attempt older than 24h neither blocks nor consumes the cap - the provider gets a real retry', async () => {
    const failedOld = {
      to: '+27820000001',
      templateName: 'provider_verification_resume_document',
      createdAt: new Date(NOW.getTime() - 30 * HOUR_MS),
      status: 'FAILED',
      metadata: { verificationId: 'v1' },
    }
    const client = clientWith([verification()], [failedOld])
    const [candidate] = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(candidate.eligibleNow).toBe(true)
    expect(candidate.priorSendsForVerification).toBe(0)
  })

  it('SENT events older than 90 days still count toward the per-verification lifetime cap', async () => {
    const ancient = (daysAgo: number) => ({
      to: '+27820000001',
      templateName: 'provider_verification_resume_document',
      createdAt: new Date(NOW.getTime() - daysAgo * 24 * HOUR_MS),
      status: 'SENT',
      metadata: { verificationId: 'v1' },
    })
    const client = clientWith([verification()], [ancient(120), ancient(95)])
    const [candidate] = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(candidate.priorSendsForVerification).toBe(2)
    expect(candidate.eligibleNow).toBe(false)
  })

  it('drops rows whose provider phone is whitespace-only', async () => {
    const client = clientWith([
      verification({ id: 'v-ws', providerId: 'p-ws', provider: { id: 'p-ws', firstName: 'W', name: null, phone: '   ', active: true } }),
      verification({ id: 'v-ok', providerId: 'p-ok', provider: { id: 'p-ok', firstName: 'O', name: null, phone: '+27820000009', active: true } }),
    ])
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows.map(r => r.verificationId)).toEqual(['v-ok'])
  })

  it('enforces a per-phone lifetime cap across verification rows - a serially-stalling provider cannot be renudged forever', async () => {
    // Review finding 6: PR #152 silently deleted the per-phone lifetime cap.
    const oldSend = (i: number) => ({
      to: '+27820000001',
      templateName: 'provider_verification_resume_consent',
      createdAt: new Date(NOW.getTime() - (48 + i) * HOUR_MS),
      status: 'SENT',
      metadata: { verificationId: `v-old-${i}` }, // all previous, different rows
    })
    const client = clientWith(
      [verification({ id: 'v-new' })],
      [oldSend(1), oldSend(2), oldSend(3), oldSend(4), oldSend(5), oldSend(6)],
    )
    const [candidate] = await listInFlightRenudgeCandidates(client, { now: NOW })
    // Fresh verification row (0 sends against it), but the phone has exhausted
    // its lifetime budget across earlier rows.
    expect(candidate.priorSendsForVerification).toBe(0)
    expect(candidate.eligibleNow).toBe(false)
  })

  it('includes provider_kyc_nudge in the dedup query so a kyc-drive nudge <24h ago blocks a resume nudge', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        to: '+27820000001',
        templateName: 'provider_kyc_nudge',
        createdAt: new Date(NOW.getTime() - 2 * HOUR_MS),
      },
    ])
    const client = {
      providerIdentityVerification: {
        findMany: vi.fn().mockResolvedValue([verification()]),
      },
      messageEvent: { findMany },
    }
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: { templateName: { in: string[] } } }).where
    expect(where.templateName.in).toContain('provider_kyc_nudge')
    expect(rows[0].eligibleNow).toBe(false)
  })

  it('does not count provider_kyc_nudge events toward the per-verification cap', async () => {
    const stale = new Date(NOW.getTime() - 40 * HOUR_MS)
    const client = clientWith(
      [verification()],
      Array.from({ length: IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION }, (_, i) => ({
        to: '+27820000001',
        templateName: 'provider_kyc_nudge',
        createdAt: new Date(stale.getTime() - i * 24 * HOUR_MS),
        metadata: { verificationId: 'v1' },
      })),
    )
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows[0].priorSendsForVerification).toBe(0)
    expect(rows[0].eligibleNow).toBe(true)
  })

  it('summarizes candidates, eligible, and exhausted counts', () => {
    const rows = [
      { eligibleNow: true, priorSendsForVerification: 0 },
      { eligibleNow: true, priorSendsForVerification: 1 },
      { eligibleNow: false, priorSendsForVerification: IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION },
      { eligibleNow: false, priorSendsForVerification: 1 },
    ] as Parameters<typeof summarizeInFlightRenudgeRows>[0]
    expect(summarizeInFlightRenudgeRows(rows)).toEqual({
      candidates: 4,
      eligibleNow: 2,
      exhausted: 1,
    })
  })
})

describe('sendInFlightRenudges', () => {
  function deps() {
    return {
      issueLink: vi.fn().mockResolvedValue({ verificationUrl: 'https://app.example/provider/verify/tok' }),
      recordAttempt: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      markAttemptFailed: vi.fn().mockResolvedValue(undefined),
      sendConsentResume: vi.fn().mockResolvedValue('wamid.consent'),
      sendDocumentResume: vi.fn().mockResolvedValue('wamid.doc'),
      sendSelfieResume: vi.fn().mockResolvedValue('wamid.selfie'),
    }
  }

  it('routes each candidate to the correct template-specific adapter', async () => {
    const client = clientWith([
      verification({ id: 'v-c', providerId: 'p-c', status: 'CONSENTED', provider: { id: 'p-c', firstName: 'Anna', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-d', providerId: 'p-d', status: 'AWAITING_DOCUMENT', identityBasis: 'WORK_PERMIT', provider: { id: 'p-d', firstName: 'Bongi', name: null, phone: '+27820000002', active: true } }),
      verification({ id: 'v-s', providerId: 'p-s', status: 'AWAITING_SELFIE', provider: { id: 'p-s', firstName: 'Carl', name: null, phone: '+27820000003', active: true } }),
    ])
    const d = deps()
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(3)
    expect(result.errors).toBe(0)
    expect(d.sendConsentResume).toHaveBeenCalledTimes(1)
    expect(d.sendSelfieResume).toHaveBeenCalledTimes(1)
    expect(d.sendDocumentResume).toHaveBeenCalledWith(expect.objectContaining({
      providerPhone: '+27820000002',
      providerFirstName: 'Bongi',
      documentFriendlyName: 'work permit',
    }))
  })

  it('records the attempt strictly before the send call', async () => {
    const client = clientWith([
      verification({ providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(d.recordAttempt.mock.invocationCallOrder[0]).toBeLessThan(d.sendDocumentResume.mock.invocationCallOrder[0])
    expect(d.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27820000001',
      templateName: 'provider_verification_resume_document',
      metadata: expect.objectContaining({ identityInFlightRenudge: true, verificationId: 'v1', providerId: 'p1' }),
    }))
  })

  it('caps sends at batchCap and reports the skipped remainder', async () => {
    const client = clientWith([
      verification({ id: 'v-a', providerId: 'p-a', provider: { id: 'p-a', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-b', providerId: 'p-b', provider: { id: 'p-b', firstName: 'B', name: null, phone: '+27820000002', active: true } }),
      verification({ id: 'v-c', providerId: 'p-c', provider: { id: 'p-c', firstName: 'C', name: null, phone: '+27820000003', active: true } }),
    ])
    const d = deps()
    const result = await sendInFlightRenudges(client, { batchCap: 2, deps: d, now: NOW })
    expect(result.sent).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('never sends when recordAttempt fails', async () => {
    const client = clientWith([
      verification({ providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    d.recordAttempt.mockRejectedValue(new Error('db unavailable'))
    const result = await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(result.sent).toBe(0)
    expect(result.errors).toBe(1)
    expect(d.sendDocumentResume).not.toHaveBeenCalled()
  })

  it('counts error and skips send when issueLink returns no URL', async () => {
    const client = clientWith([
      verification({ providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    d.issueLink.mockResolvedValue({ verificationUrl: null })
    const result = await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(result.sent).toBe(0)
    expect(result.errors).toBe(1)
    expect(d.recordAttempt).not.toHaveBeenCalled()
    expect(d.sendDocumentResume).not.toHaveBeenCalled()
  })

  it('isolates per-candidate failures: one send throwing does not stop the others', async () => {
    const client = clientWith([
      verification({ id: 'v-a', providerId: 'p-a', status: 'CONSENTED', provider: { id: 'p-a', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-b', providerId: 'p-b', status: 'AWAITING_DOCUMENT', provider: { id: 'p-b', firstName: 'B', name: null, phone: '+27820000002', active: true } }),
      verification({ id: 'v-c', providerId: 'p-c', status: 'AWAITING_SELFIE', provider: { id: 'p-c', firstName: 'C', name: null, phone: '+27820000003', active: true } }),
    ])
    const d = deps()
    d.sendDocumentResume.mockRejectedValueOnce(new Error('meta 500'))
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(2)
    expect(result.errors).toBe(1)
    expect(d.sendConsentResume).toHaveBeenCalledTimes(1)
    expect(d.sendSelfieResume).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic "document" label when identityBasis is null', async () => {
    const client = clientWith([
      verification({ providerId: 'p1', identityBasis: null, provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(d.sendDocumentResume).toHaveBeenCalledWith(expect.objectContaining({
      documentFriendlyName: 'document',
    }))
  })

  it('returns zero sends when nothing is eligible', async () => {
    const client = clientWith([])
    const d = deps()
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result).toEqual({ rows: [], sent: 0, skipped: 0, errors: 0, aborted: false })
  })

  it('passes the candidate verificationId and providerId/draftId to issueLink so the link targets the stalled row', async () => {
    const client = clientWith([
      verification({ id: 'v-target', providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    // Fix D: issueLink now receives draftId alongside providerId so it can
    // handle draft-anchored verifications in the same call signature.
    expect(d.issueLink).toHaveBeenCalledWith({ providerId: 'p1', draftId: null, verificationId: 'v-target' })
  })

  it('marks the attempt event FAILED when the send throws', async () => {
    const client = clientWith([
      verification({ providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    d.recordAttempt.mockResolvedValue({ id: 'evt-77' })
    d.sendDocumentResume.mockRejectedValue(new Error('meta 500'))
    const result = await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(result.errors).toBe(1)
    expect(d.markAttemptFailed).toHaveBeenCalledWith({ eventId: 'evt-77', failureReason: 'meta 500' })
  })

  it('does not call markAttemptFailed when the failure happens before recordAttempt', async () => {
    const client = clientWith([
      verification({ providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    d.issueLink.mockRejectedValue(new Error('link boom'))
    await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(d.markAttemptFailed).not.toHaveBeenCalled()
  })

  it('keeps looping when markAttemptFailed itself fails (event stays SENT — polite bias)', async () => {
    const client = clientWith([
      verification({ id: 'v-a', providerId: 'p-a', status: 'CONSENTED', provider: { id: 'p-a', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-b', providerId: 'p-b', status: 'AWAITING_SELFIE', provider: { id: 'p-b', firstName: 'B', name: null, phone: '+27820000002', active: true } }),
    ])
    const d = deps()
    d.sendConsentResume.mockRejectedValueOnce(new Error('meta 500'))
    d.markAttemptFailed.mockRejectedValue(new Error('db down'))
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(1)
    expect(result.errors).toBe(1)
    expect(d.sendSelfieResume).toHaveBeenCalledTimes(1)
  })

  it('never sends twice to the same phone within one run, even across verification rows', async () => {
    const client = clientWith([
      verification({ id: 'v-a', providerId: 'p1', status: 'CONSENTED', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-b', providerId: 'p1', status: 'AWAITING_SELFIE', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(1)
    expect(result.skipped).toBe(1)
    expect(d.recordAttempt).toHaveBeenCalledTimes(1)
    expect(d.sendConsentResume).toHaveBeenCalledTimes(1)
    expect(d.sendSelfieResume).not.toHaveBeenCalled()
  })

  it('holds the same-phone guard even when the first send fails after the slot was consumed', async () => {
    const client = clientWith([
      verification({ id: 'v-a', providerId: 'p1', status: 'CONSENTED', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-b', providerId: 'p1', status: 'AWAITING_SELFIE', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    d.sendConsentResume.mockRejectedValueOnce(new Error('meta 500'))
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(0)
    expect(result.errors).toBe(1)
    expect(result.skipped).toBe(1)
    expect(d.sendSelfieResume).not.toHaveBeenCalled()
  })

  it.each(['TEMPLATE_NOT_APPROVED', 'Meta error 132001: template not approved'])(
    'aborts the run on systemic template failure (%s)',
    async (message) => {
      const client = clientWith([
        verification({ id: 'v-a', providerId: 'p-a', status: 'CONSENTED', provider: { id: 'p-a', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
        verification({ id: 'v-b', providerId: 'p-b', status: 'CONSENTED', provider: { id: 'p-b', firstName: 'B', name: null, phone: '+27820000002', active: true } }),
        verification({ id: 'v-c', providerId: 'p-c', status: 'CONSENTED', provider: { id: 'p-c', firstName: 'C', name: null, phone: '+27820000003', active: true } }),
      ])
      const d = deps()
      d.recordAttempt.mockResolvedValue({ id: 'evt-1' })
      d.sendConsentResume.mockRejectedValue(new Error(message))
      const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
      expect(result.aborted).toBe(true)
      expect(result.sent).toBe(0)
      expect(result.errors).toBe(1)
      expect(d.sendConsentResume).toHaveBeenCalledTimes(1)
      expect(d.markAttemptFailed).toHaveBeenCalledWith({ eventId: 'evt-1', failureReason: message })
      // Review finding 10: the unprocessed remainder must stay accounted for —
      // sent + skipped + errors covers every eligible candidate even on abort.
      expect(result.sent + result.skipped + result.errors).toBe(3)
    },
  )

  it('does not abort on ordinary per-candidate failures', async () => {
    const client = clientWith([
      verification({ id: 'v-a', providerId: 'p-a', status: 'CONSENTED', provider: { id: 'p-a', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-b', providerId: 'p-b', status: 'CONSENTED', provider: { id: 'p-b', firstName: 'B', name: null, phone: '+27820000002', active: true } }),
    ])
    const d = deps()
    d.sendConsentResume.mockRejectedValueOnce(new Error('meta 500'))
    const result = await sendInFlightRenudges(client, { batchCap: 10, deps: d, now: NOW })
    expect(result.aborted).toBe(false)
    expect(result.sent).toBe(1)
  })
})
