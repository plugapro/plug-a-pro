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
    ['-5', 100],
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

  it('drops rows with no linked provider, no phone, or null providerId', async () => {
    const client = clientWith([
      verification({ id: 'v-ok', providerId: 'p-ok', provider: { id: 'p-ok', firstName: 'Ok', name: null, phone: '+27820000001', active: true } }),
      verification({ id: 'v-no-provider', provider: null, providerId: null }),
      verification({ id: 'v-no-phone', providerId: 'p-x', provider: { id: 'p-x', firstName: 'X', name: null, phone: null, active: true } }),
      verification({ id: 'v-null-pid', providerId: null, provider: { id: 'p-y', firstName: 'Y', name: null, phone: '+27820000002', active: true } }),
    ])
    const rows = await listInFlightRenudgeCandidates(client, { now: NOW })
    expect(rows.map(r => r.verificationId)).toEqual(['v-ok'])
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

  it('excludes FAILED events from dedup and cap counting', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      providerIdentityVerification: {
        findMany: vi.fn().mockResolvedValue([verification()]),
      },
      messageEvent: { findMany },
    }
    await listInFlightRenudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: { status: unknown } }).where
    expect(where.status).toEqual({ in: ['SENT', 'DELIVERED', 'READ'] })
  })

  it('bounds the MessageEvent scan to the last 90 days', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      providerIdentityVerification: {
        findMany: vi.fn().mockResolvedValue([verification()]),
      },
      messageEvent: { findMany },
    }
    await listInFlightRenudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: { createdAt: { gte: Date } } }).where
    expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - 90 * 24 * HOUR_MS)
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

  it('passes the candidate verificationId to issueLink so the link targets the stalled row', async () => {
    const client = clientWith([
      verification({ id: 'v-target', providerId: 'p1', provider: { id: 'p1', firstName: 'A', name: null, phone: '+27820000001', active: true } }),
    ])
    const d = deps()
    await sendInFlightRenudges(client, { batchCap: 1, deps: d, now: NOW })
    expect(d.issueLink).toHaveBeenCalledWith({ providerId: 'p1', verificationId: 'v-target' })
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
