import { describe, expect, it, vi } from 'vitest'

import {
  KYC_DRIVE_MAX_NUDGES,
  firstNameFrom,
  listKycNudgeCandidates,
  sendKycDriveNudges,
  summarizeKycNudgeRows,
  type KycNudgeClient,
} from '@/lib/kyc-drive/nudge'
import { KYC_GRACE_CUTOFF } from '@/lib/matching/kyc-grace'

const NOW = new Date('2026-06-15T08:00:00.000Z')
const PRE_CUTOFF = new Date(KYC_GRACE_CUTOFF.getTime() - 24 * 60 * 60 * 1000)
const POST_CUTOFF = new Date(KYC_GRACE_CUTOFF.getTime() + 24 * 60 * 60 * 1000)

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    firstName: 'Thabo',
    name: 'Thabo Nkosi',
    phone: '+27820000001',
    skills: ['plumbing'],
    kycStatus: 'NOT_STARTED',
    createdAt: PRE_CUTOFF,
    ...overrides,
  }
}

function clientWith(providers: unknown[], events: unknown[] = []): KycNudgeClient {
  return {
    provider: { findMany: vi.fn().mockResolvedValue(providers) },
    messageEvent: { findMany: vi.fn().mockResolvedValue(events) },
  }
}

describe('listKycNudgeCandidates', () => {
  it('targets only pre-cutoff, non-VERIFIED providers with a phone', async () => {
    const client = clientWith([
      provider({ id: 'legacy' }),
      provider({ id: 'verified', kycStatus: 'VERIFIED', phone: '+27820000002' }),
      provider({ id: 'post-cutoff', createdAt: POST_CUTOFF, phone: '+27820000003' }),
      provider({ id: 'no-phone', phone: null }),
    ])
    const rows = await listKycNudgeCandidates(client, { now: NOW })
    expect(rows.map(r => r.providerId)).toEqual(['legacy'])
  })

  it('derives cadence from provider_kyc_nudge history: spacing and max nudges', async () => {
    const recent = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
    const stale = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000)
    const client = clientWith(
      [
        provider({ id: 'fresh', phone: '+27820000001' }),
        provider({ id: 'recently-nudged', phone: '+27820000002' }),
        provider({ id: 'due-again', phone: '+27820000003' }),
        provider({ id: 'exhausted', phone: '+27820000004' }),
      ],
      [
        { to: '+27820000002', templateName: 'provider_kyc_nudge', createdAt: recent },
        { to: '+27820000003', templateName: 'provider_kyc_nudge', createdAt: stale },
        ...Array.from({ length: KYC_DRIVE_MAX_NUDGES }, (_, i) => ({
          to: '+27820000004',
          templateName: 'provider_kyc_nudge',
          createdAt: new Date(stale.getTime() - i * 8 * 24 * 60 * 60 * 1000),
        })),
      ],
    )
    const rows = await listKycNudgeCandidates(client, { now: NOW })
    const byId = new Map(rows.map(r => [r.providerId, r]))
    expect(byId.get('fresh')?.eligibleNow).toBe(true)
    expect(byId.get('recently-nudged')?.eligibleNow).toBe(false)
    expect(byId.get('due-again')?.eligibleNow).toBe(true)
    expect(byId.get('exhausted')?.eligibleNow).toBe(false)
    expect(summarizeKycNudgeRows(rows)).toEqual({ candidates: 4, eligibleNow: 2, exhausted: 1 })
  })

  it('blocks a kyc-drive nudge within 24h of an in-flight resume nudge (cross-cron politeness)', async () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000)
    const client = clientWith(
      [provider({ id: 'resumed-recently', phone: '+27820000001' })],
      [{ to: '+27820000001', templateName: 'provider_verification_resume_document', createdAt: twoHoursAgo }],
    )
    const rows = await listKycNudgeCandidates(client, { now: NOW })
    expect(rows[0].eligibleNow).toBe(false)
    expect(rows[0].nudgeCount).toBe(0)
  })

  it('ignores resume nudges older than 24h for cadence, count, and spacing', async () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
    const client = clientWith(
      [provider({ id: 'resumed-long-ago', phone: '+27820000001' })],
      [
        { to: '+27820000001', templateName: 'provider_verification_resume_consent', createdAt: threeDaysAgo },
        { to: '+27820000001', templateName: 'provider_verification_resume_selfie', createdAt: threeDaysAgo },
      ],
    )
    const rows = await listKycNudgeCandidates(client, { now: NOW })
    expect(rows[0].eligibleNow).toBe(true)
    expect(rows[0].nudgeCount).toBe(0)
    expect(rows[0].lastNudgedAt).toBeNull()
  })

  it('queries the resume templates alongside provider_kyc_nudge', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = {
      provider: { findMany: vi.fn().mockResolvedValue([provider()]) },
      messageEvent: { findMany },
    }
    await listKycNudgeCandidates(client, { now: NOW })
    const where = (findMany.mock.calls[0][0] as { where: { templateName: { in: string[] } } }).where
    expect(where.templateName.in).toEqual(expect.arrayContaining([
      'provider_kyc_nudge',
      'provider_verification_resume_consent',
      'provider_verification_resume_document',
      'provider_verification_resume_selfie',
    ]))
  })

  it('ranks thin skill categories first, case-normalized', async () => {
    const client = clientWith([
      provider({ id: 'covered-skill', skills: ['painting'], phone: '+27820000001' }),
      provider({ id: 'thin-skill', skills: ['appliances'], phone: '+27820000002' }),
      provider({ id: 'verified-painter-1', kycStatus: 'VERIFIED', skills: ['Painting'], phone: '+27820000003' }),
      provider({ id: 'verified-painter-2', kycStatus: 'VERIFIED', skills: ['painting'], phone: '+27820000004' }),
    ])
    const rows = await listKycNudgeCandidates(client, { now: NOW })
    expect(rows.map(r => r.providerId)).toEqual(['thin-skill', 'covered-skill'])
    expect(rows[0].skillRank).toBe(0)
    expect(rows[1].skillRank).toBe(2)
  })
})

describe('firstNameFrom', () => {
  it.each([
    ['Nomsa', 'Nomsa Dlamini', 'Nomsa'],
    [null, '  Thabo   Nkosi ', 'Thabo'],
    [null, null, 'there'],
    ['  ', '', 'there'],
  ])('firstName=%j name=%j -> %s', (firstName, name, expected) => {
    expect(firstNameFrom(firstName, name)).toBe(expected)
  })
})

describe('sendKycDriveNudges', () => {
  function deps() {
    return {
      issueLink: vi.fn().mockResolvedValue({ verificationUrl: 'https://app.example/provider/verify/tok123' }),
      recordAttempt: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue('wamid.1'),
    }
  }

  it('sends to eligible candidates up to the batch cap', async () => {
    const client = clientWith([
      provider({ id: 'a', phone: '+27820000001' }),
      provider({ id: 'b', phone: '+27820000002' }),
      provider({ id: 'c', phone: '+27820000003' }),
    ])
    const d = deps()
    const result = await sendKycDriveNudges(client, { deadline: '30 June 2026', batchCap: 2, deps: d, now: NOW })
    expect(result.sent).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.errors).toBe(0)
    expect(d.send).toHaveBeenCalledTimes(2)
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({
      deadline: '30 June 2026',
      verificationUrl: 'https://app.example/provider/verify/tok123',
    }))
    expect(d.recordAttempt).toHaveBeenCalledTimes(2)
    expect(d.recordAttempt.mock.invocationCallOrder[0]).toBeLessThan(d.send.mock.invocationCallOrder[0])
  })

  it('never sends when the attempt cannot be recorded', async () => {
    const client = clientWith([provider({ id: 'a', phone: '+27820000001' })])
    const d = deps()
    d.recordAttempt.mockRejectedValue(new Error('db down'))
    const result = await sendKycDriveNudges(client, { deadline: '30 June 2026', batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(0)
    expect(result.errors).toBe(1)
    expect(d.send).not.toHaveBeenCalled()
  })

  it('isolates per-provider failures and keeps sending', async () => {
    const client = clientWith([
      provider({ id: 'a', phone: '+27820000001' }),
      provider({ id: 'b', phone: '+27820000002' }),
      provider({ id: 'c', phone: '+27820000003' }),
    ])
    const d = deps()
    d.issueLink
      .mockResolvedValueOnce({ verificationUrl: null })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ verificationUrl: 'https://app.example/provider/verify/tok456' })
    const result = await sendKycDriveNudges(client, { deadline: '30 June 2026', batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(1)
    expect(result.errors).toBe(2)
    expect(d.send).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when no candidate is eligible', async () => {
    const recent = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
    const client = clientWith(
      [provider({ id: 'a', phone: '+27820000001' })],
      [{ to: '+27820000001', createdAt: recent }],
    )
    const d = deps()
    const result = await sendKycDriveNudges(client, { deadline: '30 June 2026', batchCap: 10, deps: d, now: NOW })
    expect(result.sent).toBe(0)
    expect(d.send).not.toHaveBeenCalled()
  })
})

// ─── PR #152 review-finding regressions ──────────────────────────────────────

describe('FAILED-event bookkeeping (review findings 2+3)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  it('FAILED nudge events consume neither the lifetime cap nor the 7-day spacing - zero-delivery providers keep their budget', async () => {
    const failedAt = (daysAgo: number) => ({
      to: '+27820000001',
      templateName: 'provider_kyc_nudge',
      createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      status: 'FAILED',
    })
    const client = clientWith(
      [provider({ id: 'zero-delivery' })],
      [failedAt(20), failedAt(13), failedAt(6)], // 3 attempts, nothing delivered
    )
    const [row] = await listKycNudgeCandidates(client, { now: NOW })
    expect(row.nudgeCount).toBe(0)
    expect(row.eligibleNow).toBe(true)
  })

  it('a FAILED attempt within the last 24h still blocks re-sending (retry floor, bounds daily retries)', async () => {
    const client = clientWith(
      [provider({ id: 'just-failed' })],
      [{
        to: '+27820000001',
        templateName: 'provider_kyc_nudge',
        createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
        status: 'FAILED',
      }],
    )
    const [row] = await listKycNudgeCandidates(client, { now: NOW })
    expect(row.nudgeCount).toBe(0)
    expect(row.eligibleNow).toBe(false)
  })

  it('queries and keys history by the TRIMMED phone so whitespace-padded provider rows still match their own history', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        to: '+27820000001', // events are recorded under the trimmed phone
        templateName: 'provider_kyc_nudge',
        createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
        status: 'SENT',
      },
    ])
    const client = {
      provider: {
        findMany: vi.fn().mockResolvedValue([provider({ id: 'padded', phone: '  +27820000001  ' })]),
      },
      messageEvent: { findMany },
    }
    const [row] = await listKycNudgeCandidates(client, { now: NOW })
    // Query must use the trimmed phone or the history lookup can never match.
    const where = (findMany.mock.calls[0][0] as { where: { to: { in: string[] } } }).where
    expect(where.to.in).toEqual(['+27820000001'])
    // And the recent SENT event must be found: spacing blocks this provider.
    expect(row.nudgeCount).toBe(1)
    expect(row.eligibleNow).toBe(false)
  })
})

describe('markAttemptFailed wiring (attempt-first symmetry with the renudge cron)', () => {
  function depsWithFail() {
    return {
      issueLink: vi.fn().mockResolvedValue({ verificationUrl: 'https://app.example/provider/verify/tok' }),
      recordAttempt: vi.fn().mockResolvedValue({ id: 'evt-9' }),
      markAttemptFailed: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockRejectedValue(new Error('meta 500')),
    }
  }

  it('flips the attempt event to FAILED when the send throws, so the cap is not consumed by a non-delivery', async () => {
    const client = clientWith([provider({ id: 'a' })])
    const d = depsWithFail()
    const result = await sendKycDriveNudges(client, { deadline: '30 June 2026', batchCap: 10, deps: d, now: NOW })
    expect(result.errors).toBe(1)
    expect(d.markAttemptFailed).toHaveBeenCalledWith({ eventId: 'evt-9', failureReason: 'meta 500' })
  })
})
