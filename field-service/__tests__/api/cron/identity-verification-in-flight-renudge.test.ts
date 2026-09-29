import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level tests for the in-flight identity-verification re-nudge cron.
// The selection module is REAL; only the database, flags, link issuers,
// MessageEvent writers and WhatsApp senders are mocked, so a dry run is proven
// to reach none of the write/send paths.

const HOUR_MS = 60 * 60 * 1000

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    providerIdentityVerification: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    messageEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))
const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))
const { mockIssueProviderLink, mockIssueDraftLink } = vi.hoisted(() => ({
  mockIssueProviderLink: vi.fn(),
  mockIssueDraftLink: vi.fn(),
}))
const { mockLogOutbound, mockMarkFailed } = vi.hoisted(() => ({
  mockLogOutbound: vi.fn(),
  mockMarkFailed: vi.fn(),
}))
const { mockSendConsent, mockSendDocument, mockSendSelfie } = vi.hoisted(() => ({
  mockSendConsent: vi.fn(),
  mockSendDocument: vi.fn(),
  mockSendSelfie: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: mockIssueProviderLink,
}))
vi.mock('@/lib/identity-verification/application-link', () => ({
  issueProviderApplicationVerificationLink: mockIssueDraftLink,
}))
vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: mockLogOutbound,
  markOutboundMessageFailed: mockMarkFailed,
}))
vi.mock('@/lib/whatsapp', () => ({
  sendProviderVerificationResumeConsent: mockSendConsent,
  sendProviderVerificationResumeDocument: mockSendDocument,
  sendProviderVerificationResumeSelfie: mockSendSelfie,
}))

import { GET } from '@/app/api/cron/identity-verification-in-flight-renudge/route'

const CRON_SECRET = 'cron-secret'
const BASE = 'http://localhost/api/cron/identity-verification-in-flight-renudge'

function request(query = '', secret = CRON_SECRET) {
  return new Request(`${BASE}${query}`, { headers: { authorization: `Bearer ${secret}` } })
}

function livenessDraftRow(id: string, phone: string) {
  return {
    id,
    providerId: null,
    provider: null,
    providerApplicationDraftId: `draft-${id}`,
    providerApplicationDraft: { id: `draft-${id}`, phone, name: 'Sipho Dlamini' },
    status: 'AWAITING_LIVENESS',
    identityBasis: 'SA_ID',
    updatedAt: new Date(Date.now() - 8 * 24 * HOUR_MS),
    // Didit session died 24h ago — the only kind of liveness row selectable.
    livenessSessionExpiresAt: new Date(Date.now() - 24 * HOUR_MS),
    expiresAt: null,
  }
}

function selfieProviderRow(id: string, phone: string) {
  return {
    id,
    providerId: `p-${id}`,
    provider: { id: `p-${id}`, firstName: 'Thandi', name: 'Thandi M', phone, active: true },
    providerApplicationDraftId: null,
    providerApplicationDraft: null,
    status: 'AWAITING_SELFIE',
    identityBasis: 'SA_ID',
    updatedAt: new Date(Date.now() - 24 * HOUR_MS),
    expiresAt: null,
  }
}

type WindowRange = { gte: Date; lte: Date }
type SelectionWhere = {
  AND: Array<{ OR: [{ updatedAt: WindowRange }, { livenessSessionExpiresAt: WindowRange }] }>
}

// Returns the time window the library queried. The two status groups
// (pre-Didit on updatedAt, AWAITING_LIVENESS on livenessSessionExpiresAt)
// must always share one window; assert that here so every caller checks it.
function verificationWhere(callIndex = 0): { updatedAt: WindowRange } {
  const { where } = mockDb.providerIdentityVerification.findMany.mock.calls[callIndex][0] as { where: SelectionWhere }
  const [legacy, liveness] = where.AND[0].OR
  expect(liveness.livenessSessionExpiresAt.gte.getTime()).toBe(legacy.updatedAt.gte.getTime())
  expect(liveness.livenessSessionExpiresAt.lte.getTime()).toBe(legacy.updatedAt.lte.getTime())
  return { updatedAt: legacy.updatedAt }
}

function expectNoWritesOrSends() {
  expect(mockIssueProviderLink).not.toHaveBeenCalled()
  expect(mockIssueDraftLink).not.toHaveBeenCalled()
  expect(mockLogOutbound).not.toHaveBeenCalled()
  expect(mockMarkFailed).not.toHaveBeenCalled()
  expect(mockSendConsent).not.toHaveBeenCalled()
  expect(mockSendDocument).not.toHaveBeenCalled()
  expect(mockSendSelfie).not.toHaveBeenCalled()
  for (const model of [mockDb.providerIdentityVerification, mockDb.messageEvent]) {
    expect(model.create).not.toHaveBeenCalled()
    expect(model.update).not.toHaveBeenCalled()
    expect(model.updateMany).not.toHaveBeenCalled()
  }
}

describe('GET /api/cron/identity-verification-in-flight-renudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.IDENTITY_RENUDGE_BATCH_CAP
    mockIsEnabled.mockResolvedValue(false)
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([
      livenessDraftRow('v-l1', '+27820000101'),
      livenessDraftRow('v-l2', '+27820000102'),
      selfieProviderRow('v-s1', '+27820000103'),
    ])
    mockDb.messageEvent.findMany.mockResolvedValue([
      // v-l2's phone was messaged 2h ago → selected but not eligible now.
      {
        to: '+27820000102',
        templateName: 'provider_verification_resume_selfie',
        createdAt: new Date(Date.now() - 2 * HOUR_MS),
        status: 'SENT',
        metadata: { verificationId: 'other' },
      },
    ])
    mockIssueProviderLink.mockResolvedValue({ verificationUrl: 'https://app.example/provider/verify/p' })
    mockIssueDraftLink.mockResolvedValue({ verificationUrl: 'https://app.example/provider/verify/d' })
    mockLogOutbound.mockResolvedValue({ id: 'evt-1' })
    mockSendConsent.mockResolvedValue('wamid.c')
    mockSendDocument.mockResolvedValue('wamid.d')
    mockSendSelfie.mockResolvedValue('wamid.s')
  })

  it('rejects a bad CRON_SECRET before reading any query param or the database', async () => {
    const res = await GET(request('?dryRun=1&windowEndHours=2160', 'wrong'))
    expect(res.status).toBe(401)
    expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
    expectNoWritesOrSends()
  })

  it('dryRun=1 returns counts by status and performs no writes or sends, even with the send flag ON', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const res = await GET(request('?dryRun=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      mode: 'dry_run',
      dryRun: true,
      candidates: 3,
      eligibleNow: 2,
      byStatus: { AWAITING_LIVENESS: 2, AWAITING_SELFIE: 1 },
      eligibleByStatus: { AWAITING_LIVENESS: 1, AWAITING_SELFIE: 1 },
      window: { startHours: 20, endHours: 28 },
    })
    expectNoWritesOrSends()
  })

  it('dryRun honours the window override for the backlog sweep', async () => {
    const before = Date.now()
    const res = await GET(request('?dryRun=1&windowStartHours=20&windowEndHours=2160'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.window).toEqual({ startHours: 20, endHours: 2160 })
    const where = verificationWhere()
    const spanHours = (where.updatedAt.lte.getTime() - where.updatedAt.gte.getTime()) / HOUR_MS
    expect(spanHours).toBe(2160 - 20)
    expect(where.updatedAt.lte.getTime()).toBeLessThanOrEqual(before - 20 * HOUR_MS + 1000)
    expectNoWritesOrSends()
  })

  it('caps windowEndHours at 120 days so a typo cannot sweep years', async () => {
    const res = await GET(request('?dryRun=1&windowEndHours=999999'))
    const body = await res.json()
    expect(body.window).toEqual({ startHours: 20, endHours: 24 * 120 })
    const where = verificationWhere()
    const spanHours = (where.updatedAt.lte.getTime() - where.updatedAt.gte.getTime()) / HOUR_MS
    expect(spanHours).toBe(24 * 120 - 20)
  })

  it.each([
    ['?windowEndHours=abc'],
    ['?windowEndHours=-5'],
    ['?windowStartHours=1.5'],
    ['?windowStartHours=48&windowEndHours=24'],
    ['?windowStartHours=30'],
    ['?windowStartHours=0&windowEndHours=2160'],
    ['?windowStartHours=19&windowEndHours=2160'],
  ])('rejects invalid window override %s with 400 and touches nothing', async (query) => {
    const res = await GET(request(query))
    expect(res.status).toBe(400)
    expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
    expectNoWritesOrSends()
  })

  it('no params + flag OFF: unchanged report-only response shape and default 20-28h window', async () => {
    const res = await GET(request())
    const body = await res.json()
    expect(Object.keys(body)).toEqual([
      'ok', 'mode', 'durationMs', 'sent', 'skipped', 'errors', 'candidates', 'eligibleNow', 'exhausted',
    ])
    expect(body).toMatchObject({ ok: true, mode: 'report_only', sent: 0, candidates: 3, eligibleNow: 2 })
    const where = verificationWhere()
    expect((where.updatedAt.lte.getTime() - where.updatedAt.gte.getTime()) / HOUR_MS).toBe(8)
    expectNoWritesOrSends()
  })

  it('no params + flag ON: unchanged auto_nudge response shape; liveness row goes out as the selfie template', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const res = await GET(request())
    const body = await res.json()
    expect(Object.keys(body)).toEqual([
      'ok', 'mode', 'durationMs', 'sent', 'skipped', 'errors', 'aborted', 'candidates', 'eligibleNow', 'exhausted',
    ])
    expect(body).toMatchObject({ mode: 'auto_nudge', sent: 2, errors: 0 })
    expect(mockIssueDraftLink).toHaveBeenCalledWith({ providerApplicationDraftId: 'draft-v-l1', channel: 'PWA' })
    expect(mockSendSelfie).toHaveBeenCalledWith(expect.objectContaining({
      providerPhone: '+27820000101',
      verificationUrl: 'https://app.example/provider/verify/d',
    }))
    expect(mockSendSelfie).not.toHaveBeenCalledWith(expect.objectContaining({ providerPhone: '+27820000102' }))
  })

  it('flag ON + window override (no dryRun): sends using the overridden window', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const res = await GET(request('?windowStartHours=20&windowEndHours=2160'))
    const body = await res.json()
    expect(body).toMatchObject({ mode: 'auto_nudge', window: { startHours: 20, endHours: 2160 } })
    const where = verificationWhere()
    expect((where.updatedAt.lte.getTime() - where.updatedAt.gte.getTime()) / HOUR_MS).toBe(2160 - 20)
    expect(mockLogOutbound).toHaveBeenCalled()
  })

  describe('fix round 1: fail-closed dryRun and minimum windowStartHours', () => {
    it.each(['True', 'yes', 'tru', 'TRUE', '', '2'])(
      'dryRun=%j returns 400 before any database read and never sends, even with the flag ON',
      async (value) => {
        mockIsEnabled.mockResolvedValue(true)
        const res = await GET(request(`?dryRun=${value}`))
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ ok: false, error: 'dryRun must be 1, true, 0 or false' })
        expect(mockIsEnabled).not.toHaveBeenCalled()
        expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
        expect(mockDb.messageEvent.findMany).not.toHaveBeenCalled()
        expectNoWritesOrSends()
      },
    )

    it.each(['0', 'false'])('dryRun=%s proceeds exactly like no parameter (flag OFF: report_only)', async (value) => {
      const baseline = await (await GET(request())).json()
      const base = verificationWhere()
      vi.clearAllMocks()
      const res = await GET(request(`?dryRun=${value}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Object.keys(body)).toEqual(Object.keys(baseline))
      expect({ ...body, durationMs: 0 }).toEqual({ ...baseline, durationMs: 0 })
      const args = verificationWhere()
      expect(args.updatedAt.lte.getTime() - args.updatedAt.gte.getTime())
        .toBe(base.updatedAt.lte.getTime() - base.updatedAt.gte.getTime())
      expectNoWritesOrSends()
    })

    it.each(['0', 'false'])('dryRun=%s with the flag ON sends exactly like no parameter (auto_nudge)', async (value) => {
      mockIsEnabled.mockResolvedValue(true)
      const res = await GET(request(`?dryRun=${value}`))
      const body = await res.json()
      expect(Object.keys(body)).toEqual([
        'ok', 'mode', 'durationMs', 'sent', 'skipped', 'errors', 'aborted', 'candidates', 'eligibleNow', 'exhausted',
      ])
      expect(body).toMatchObject({ mode: 'auto_nudge', sent: 2 })
    })

    it.each([
      ['?windowStartHours=0&windowEndHours=2160'],
      ['?windowStartHours=0'],
      ['?dryRun=1&windowStartHours=0&windowEndHours=2160'],
    ])('%s returns 400 "at least 20" with no library call', async (query) => {
      const res = await GET(request(query))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: 'windowStartHours must be at least 20' })
      expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
      expectNoWritesOrSends()
    })

    it('windowStartHours=19 returns 400', async () => {
      const res = await GET(request('?windowStartHours=19&windowEndHours=2160'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: 'windowStartHours must be at least 20' })
      expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
    })

    it('windowStartHours=20&windowEndHours=2160 is accepted with window {20, 2160}', async () => {
      const res = await GET(request('?dryRun=1&windowStartHours=20&windowEndHours=2160'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.window).toEqual({ startHours: 20, endHours: 2160 })
      expect(mockDb.providerIdentityVerification.findMany).toHaveBeenCalledTimes(1)
      expectNoWritesOrSends()
    })
  })

  describe('fix round 2: unknown query parameter names are rejected', () => {
    it.each([
      ['?dryrun=1', 'dryrun'],
      ['?dry_run=1&windowStartHours=20&windowEndHours=2160', 'dry_run'],
      ['?dryRun=1&foo=bar', 'foo'],
      ['?windowstarthours=20', 'windowstarthours'],
      ['?DryRun=1&windowEndHours=2160', 'DryRun'],
    ])('%s returns 400 naming %s before any database read, even with the flag ON', async (query, name) => {
      mockIsEnabled.mockResolvedValue(true)
      const res = await GET(request(query))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: `unknown query parameter: ${name}` })
      expect(mockIsEnabled).not.toHaveBeenCalled()
      expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
      expect(mockDb.messageEvent.findMany).not.toHaveBeenCalled()
      expectNoWritesOrSends()
    })

    it('unknown names are still rejected behind the CRON_SECRET gate (401 first)', async () => {
      const res = await GET(request('?dryrun=1', 'wrong'))
      expect(res.status).toBe(401)
    })

    it('all three accepted names together are allowed', async () => {
      const res = await GET(request('?dryRun=1&windowStartHours=20&windowEndHours=2160'))
      expect(res.status).toBe(200)
      expect((await res.json()).window).toEqual({ startHours: 20, endHours: 2160 })
      expectNoWritesOrSends()
    })
  })

  describe('fix round 3: duplicate query parameter names are rejected', () => {
    it.each([
      ['?dryRun=0&dryRun=1&windowEndHours=2160', 'dryRun'],
      ['?dryRun=1&dryRun=1', 'dryRun'],
      ['?windowStartHours=20&windowStartHours=30&windowEndHours=2160', 'windowStartHours'],
      ['?dryRun=1&windowEndHours=2160&windowEndHours=48', 'windowEndHours'],
    ])('%s returns 400 naming %s before any database read, even with the flag ON', async (query, name) => {
      mockIsEnabled.mockResolvedValue(true)
      const res = await GET(request(query))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, error: `duplicate query parameter: ${name}` })
      expect(mockIsEnabled).not.toHaveBeenCalled()
      expect(mockDb.providerIdentityVerification.findMany).not.toHaveBeenCalled()
      expect(mockDb.messageEvent.findMany).not.toHaveBeenCalled()
      expectNoWritesOrSends()
    })
  })
})
