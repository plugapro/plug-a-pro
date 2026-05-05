import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

// ─── Hoist mocks before any imports that touch the modules ───────────────────
const mockDb = vi.hoisted(() => ({
  customer: { findUnique: vi.fn(), create: vi.fn() },
  address: { findFirst: vi.fn(), create: vi.fn() },
  jobRequest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  attachment: { findFirst: vi.fn(), create: vi.fn() },
  lead: { findUnique: vi.fn(), upsert: vi.fn() },
  dispatchDecision: { create: vi.fn(), update: vi.fn() },
  matchAttempt: { create: vi.fn() },
  assignmentHold: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  provider: { findFirst: vi.fn() },
  providerWallet: { findUnique: vi.fn() },
  $transaction: vi.fn(),
  $disconnect: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/provider-wallet', () => ({
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5_000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5_000,
  creditPromoCreditsInTransaction: vi.fn().mockResolvedValue({ wallet: {}, ledgerEntries: [] }),
}))
vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({
    url: 'https://blob.example.com/job-requests/jr-1/photo.png',
    pathname: 'job-requests/jr-1/photo.png',
  }),
}))
vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('fakedata')),
  statSync: vi.fn().mockReturnValue({ size: 8 }),
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue([]),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
}))

import {
  normalisePhone,
  classifyImages,
  buildAvailabilityWindow,
  upsertCustomer,
  upsertAddress,
  upsertJobRequest,
  uploadAndAttach,
  createLeadChain,
  findFannie,
  ensureFannieHasCredits,
  assertSafeToRun,
} from '../../scripts/seed-west-rand-test-leads'
import type { ImageMappingEntry, CustomerConfig } from '../../scripts/seed-west-rand-test-leads.config'
import { creditPromoCreditsInTransaction } from '../../lib/provider-wallet'
import { put } from '@vercel/blob'

afterEach(() => vi.clearAllMocks())

// ─── normalisePhone ───────────────────────────────────────────────────────────

describe('normalisePhone', () => {
  it('converts 082-format to E.164', () => {
    expect(normalisePhone('0827006695')).toBe('+27827006695')
  })
  it('converts +27 format unchanged', () => {
    expect(normalisePhone('+27827006695')).toBe('+27827006695')
  })
  it('converts 27-prefix to E.164', () => {
    expect(normalisePhone('27764010810')).toBe('+27764010810')
  })
  it('strips spaces', () => {
    expect(normalisePhone('+27 82 700 6695')).toBe('+27827006695')
  })
  it('strips hyphens and spaces in local format', () => {
    expect(normalisePhone('082 700 6695')).toBe('+27827006695')
  })
  it('throws on non-SA number', () => {
    expect(() => normalisePhone('+1 555 000 1234')).toThrow(/South African/)
  })
  it('throws on short number', () => {
    expect(() => normalisePhone('12345')).toThrow()
  })
})

// ─── classifyImages ───────────────────────────────────────────────────────────

describe('classifyImages', () => {
  const mapping: Record<string, ImageMappingEntry> = {
    ABCDEF: { customerKey: 'masego-mataboge', label: 'evidence', caption: 'Drain' },
  }

  it('classifies a known file', () => {
    const result = classifyImages(['ABCDEF.PNG', 'UNKNOWN.PNG'], mapping)
    expect(result.classified).toHaveLength(1)
    expect(result.classified[0].filename).toBe('ABCDEF.PNG')
    expect(result.classified[0].customerKey).toBe('masego-mataboge')
    expect(result.needsReview).toEqual(['UNKNOWN.PNG'])
  })

  it('returns all files in needsReview when mapping is empty', () => {
    const result = classifyImages(['A.PNG', 'B.PNG'], {})
    expect(result.classified).toHaveLength(0)
    expect(result.needsReview).toHaveLength(2)
  })

  it('is case-insensitive on extension', () => {
    const result = classifyImages(['ABCDEF.png'], mapping)
    expect(result.classified).toHaveLength(1)
  })

  it('strips extension when looking up mapping key', () => {
    const result = classifyImages(['ABCDEF.PNG'], mapping)
    expect(result.classified[0].entry.label).toBe('evidence')
  })
})

// ─── buildAvailabilityWindow ──────────────────────────────────────────────────

describe('buildAvailabilityWindow', () => {
  const base = new Date('2026-05-01T08:00:00.000Z')

  it('urgent: window starts in 2h, ends in 4h', () => {
    const w = buildAvailabilityWindow('urgent', base)
    expect(w.start.getTime()).toBe(base.getTime() + 2 * 3_600_000)
    expect(w.end.getTime()).toBe(base.getTime() + 4 * 3_600_000)
  })

  it('mornings: tomorrow 07–12 SAST (5-hour window)', () => {
    const w = buildAvailabilityWindow('mornings', base)
    expect(w.start.getTime()).toBeGreaterThan(base.getTime())
    expect(w.end.getTime() - w.start.getTime()).toBe(5 * 3_600_000)
  })

  it('flexible: day-after-tomorrow 07–17 SAST (10-hour window)', () => {
    const w = buildAvailabilityWindow('flexible', base)
    expect(w.start.getTime()).toBeGreaterThan(base.getTime())
    expect(w.end.getTime() - w.start.getTime()).toBe(10 * 3_600_000)
  })
})

// ─── upsertCustomer ───────────────────────────────────────────────────────────

const testCustomer: CustomerConfig = {
  key: 'masego-mataboge',
  name: 'Masego Mataboge',
  phone: '+27827006695',
  category: 'plumbing',
  title: 'Blocked shower drain',
  description: 'Water drains slowly.',
  availability: 'urgent',
  address: {
    label: 'Home',
    street: '14 Sunset Road',
    suburb: 'Ruimsig',
    city: 'Roodepoort',
    province: 'Gauteng',
    postalCode: '1724',
    lat: -26.08,
    lng: 27.853,
  },
}

describe('upsertCustomer', () => {
  it('returns existing customer when found', async () => {
    const existing = { id: 'cust-1', phone: '+27827006695', name: 'Masego Mataboge' }
    mockDb.customer.findUnique.mockResolvedValueOnce(existing)

    const result = await upsertCustomer(testCustomer, true)
    expect(result.customer).toBe(existing)
    expect(result.created).toBe(false)
    expect(mockDb.customer.create).not.toHaveBeenCalled()
  })

  it('creates customer when not found', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce(null)
    const created = { id: 'cust-2', phone: '+27827006695', name: 'Masego Mataboge' }
    mockDb.customer.create.mockResolvedValueOnce(created)

    const result = await upsertCustomer(testCustomer, true)
    expect(result.customer).toBe(created)
    expect(result.created).toBe(true)
    expect(mockDb.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '+27827006695',
          name: 'Masego Mataboge',
          isTestUser: true,
          cohortName: 'west-rand-pilot-seed',
          channel: 'PWA',
          whatsappServiceOptIn: false,
        }),
      }),
    )
  })

  it('does not create in dry-run mode', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce(null)

    const result = await upsertCustomer(testCustomer, false)
    expect(mockDb.customer.create).not.toHaveBeenCalled()
    expect(result.customer).toBeNull()
    expect(result.created).toBe(false)
  })
})

// ─── upsertAddress ────────────────────────────────────────────────────────────

describe('upsertAddress', () => {
  it('returns existing address by customerId + street + suburb', async () => {
    const existing = { id: 'addr-1', street: '14 Sunset Road', suburb: 'Ruimsig' }
    mockDb.address.findFirst.mockResolvedValueOnce(existing)

    const result = await upsertAddress('cust-1', testCustomer.address, true)
    expect(result.address).toBe(existing)
    expect(result.created).toBe(false)
    expect(mockDb.address.create).not.toHaveBeenCalled()
  })

  it('creates address when not found', async () => {
    mockDb.address.findFirst.mockResolvedValueOnce(null)
    const created = { id: 'addr-2' }
    mockDb.address.create.mockResolvedValueOnce(created)

    const result = await upsertAddress('cust-1', testCustomer.address, true)
    expect(result.address).toBe(created)
    expect(result.created).toBe(true)
    expect(mockDb.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-1',
          street: '14 Sunset Road',
          suburb: 'Ruimsig',
          city: 'Roodepoort',
          province: 'Gauteng',
          lat: -26.08,
          lng: 27.853,
          isDefault: true,
        }),
      }),
    )
  })

  it('skips create in dry-run', async () => {
    mockDb.address.findFirst.mockResolvedValueOnce(null)

    const result = await upsertAddress('cust-1', testCustomer.address, false)
    expect(result.address).toBeNull()
    expect(mockDb.address.create).not.toHaveBeenCalled()
  })
})

// ─── upsertJobRequest ─────────────────────────────────────────────────────────

describe('upsertJobRequest', () => {
  const customer = { id: 'cust-1', phone: '+27827006695', name: 'Masego' }

  it('returns existing request for same customer + cohort + category', async () => {
    const existing = { id: 'jr-1', status: 'MATCHING' }
    mockDb.jobRequest.findFirst.mockResolvedValueOnce(existing)

    const result = await upsertJobRequest(customer, { id: 'addr-1' }, testCustomer, true)
    expect(result.jobRequest).toBe(existing)
    expect(result.created).toBe(false)
  })

  it('creates job request when not found', async () => {
    mockDb.jobRequest.findFirst.mockResolvedValueOnce(null)
    const created = { id: 'jr-2', status: 'MATCHING' }
    mockDb.jobRequest.create.mockResolvedValueOnce(created)

    const result = await upsertJobRequest(customer, { id: 'addr-1' }, testCustomer, true)
    expect(result.created).toBe(true)
    expect(mockDb.jobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-1',
          addressId: 'addr-1',
          category: 'plumbing',
          title: 'Blocked shower drain',
          isTestRequest: true,
          cohortName: 'west-rand-pilot-seed',
          status: 'MATCHING',
        }),
      }),
    )
  })

  it('skips create in dry-run', async () => {
    mockDb.jobRequest.findFirst.mockResolvedValueOnce(null)

    const result = await upsertJobRequest(customer, null, testCustomer, false)
    expect(result.jobRequest).toBeNull()
    expect(mockDb.jobRequest.create).not.toHaveBeenCalled()
  })
})

// ─── uploadAndAttach ──────────────────────────────────────────────────────────

describe('uploadAndAttach', () => {
  it('calls put with correct blob key pattern', async () => {
    mockDb.attachment.create.mockResolvedValueOnce({ id: 'att-1' })

    await uploadAndAttach({
      jobRequestId: 'jr-1',
      imagePath: '/images/ABCDEF.PNG',
      label: 'evidence',
      caption: 'Drain photo',
      uploadedBy: 'system:seed-script',
      commit: true,
    })

    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^job-requests\/jr-1\//),
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', contentType: 'image/png' }),
    )
  })

  it('creates attachment record after upload', async () => {
    mockDb.attachment.create.mockResolvedValueOnce({ id: 'att-1' })

    const result = await uploadAndAttach({
      jobRequestId: 'jr-1',
      imagePath: '/images/ABCDEF.PNG',
      label: 'evidence',
      caption: 'Drain photo',
      uploadedBy: 'system:seed-script',
      commit: true,
    })

    expect(result?.id).toBe('att-1')
    expect(mockDb.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobRequestId: 'jr-1',
          label: 'evidence',
          uploadedBy: 'system:seed-script',
          mimeType: 'image/png',
        }),
      }),
    )
  })

  it('skips upload in dry-run', async () => {
    const result = await uploadAndAttach({
      jobRequestId: 'jr-1',
      imagePath: '/images/ABCDEF.PNG',
      label: 'evidence',
      caption: null,
      uploadedBy: 'system:seed-script',
      commit: false,
    })

    expect(put).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

// ─── createLeadChain ─────────────────────────────────────────────────────────

const fannieProvider = { id: 'prov-1', phone: '+27820000001', name: 'Fannie Dlamini' }

describe('createLeadChain', () => {
  it('returns null in dry-run when no existing lead', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(null)

    const result = await createLeadChain({
      jobRequestId: 'jr-1',
      provider: fannieProvider,
      commit: false,
    })

    expect(result).toBeNull()
    expect(mockDb.dispatchDecision.create).not.toHaveBeenCalled()
  })

  it('returns existing lead if SENT and resetExisting=false', async () => {
    const existingLead = {
      id: 'lead-1',
      status: 'SENT',
      assignmentHoldId: 'hold-1',
      matchAttemptId: 'att-1',
      dispatchDecisionId: 'dec-1',
    }
    mockDb.lead.findUnique.mockResolvedValueOnce(existingLead)

    const result = await createLeadChain({
      jobRequestId: 'jr-1',
      provider: fannieProvider,
      commit: true,
      resetExisting: false,
    })

    expect(result?.leadId).toBe('lead-1')
    expect(result?.alreadyExisted).toBe(true)
    expect(mockDb.dispatchDecision.create).not.toHaveBeenCalled()
  })

  it('creates all 4 records when lead does not exist', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(null)
    mockDb.assignmentHold.updateMany.mockResolvedValueOnce({ count: 0 })
    mockDb.dispatchDecision.create.mockResolvedValueOnce({ id: 'dec-1' })
    mockDb.matchAttempt.create.mockResolvedValueOnce({ id: 'att-1' })
    mockDb.dispatchDecision.update.mockResolvedValueOnce({ id: 'dec-1' })
    mockDb.assignmentHold.create.mockResolvedValueOnce({ id: 'hold-1' })
    mockDb.lead.upsert.mockResolvedValueOnce({ id: 'lead-1', status: 'SENT' })

    const result = await createLeadChain({
      jobRequestId: 'jr-1',
      provider: fannieProvider,
      commit: true,
    })

    expect(mockDb.dispatchDecision.create).toHaveBeenCalledOnce()
    expect(mockDb.matchAttempt.create).toHaveBeenCalledOnce()
    expect(mockDb.assignmentHold.create).toHaveBeenCalledOnce()
    expect(mockDb.lead.upsert).toHaveBeenCalledOnce()
    expect(result?.leadId).toBe('lead-1')
    expect(result?.alreadyExisted).toBe(false)
    expect(result?.holdId).toBe('hold-1')
    expect(result?.dispatchDecisionId).toBe('dec-1')
  })

  it('releases existing active hold before creating new one', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(null)
    mockDb.assignmentHold.updateMany.mockResolvedValueOnce({ count: 1 })
    mockDb.dispatchDecision.create.mockResolvedValueOnce({ id: 'dec-1' })
    mockDb.matchAttempt.create.mockResolvedValueOnce({ id: 'att-1' })
    mockDb.dispatchDecision.update.mockResolvedValueOnce({ id: 'dec-1' })
    mockDb.assignmentHold.create.mockResolvedValueOnce({ id: 'hold-2' })
    mockDb.lead.upsert.mockResolvedValueOnce({ id: 'lead-1', status: 'SENT' })

    await createLeadChain({ jobRequestId: 'jr-1', provider: fannieProvider, commit: true })

    expect(mockDb.assignmentHold.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ jobRequestId: 'jr-1', providerId: 'prov-1', status: 'ACTIVE' }),
        data: expect.objectContaining({ status: 'RELEASED' }),
      }),
    )
  })
})

// ─── findFannie ───────────────────────────────────────────────────────────────

describe('findFannie', () => {
  it('searches by name fragment (case-insensitive)', async () => {
    const fannie = { id: 'prov-1', name: 'Fannie Dlamini', phone: '+27820000001', active: true }
    mockDb.provider.findFirst.mockResolvedValueOnce(fannie)

    const result = await findFannie('Fannie')
    expect(result).toBe(fannie)
    expect(mockDb.provider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'Fannie', mode: 'insensitive' },
          active: true,
        }),
      }),
    )
  })

  it('returns null when not found', async () => {
    mockDb.provider.findFirst.mockResolvedValueOnce(null)
    expect(await findFannie('Fannie')).toBeNull()
  })
})

// ─── ensureFannieHasCredits ───────────────────────────────────────────────────

describe('ensureFannieHasCredits', () => {
  it('does not top up when balance is already sufficient', async () => {
    mockDb.providerWallet.findUnique.mockResolvedValueOnce({
      id: 'w-1',
      paidCreditBalance: 3,
      promoCreditBalance: 5,
      status: 'ACTIVE',
    })

    const result = await ensureFannieHasCredits('prov-1', 5, 10, true)
    expect(result.toppedUp).toBe(false)
    expect(result.creditsAdded).toBe(0)
    expect(result.totalBalance).toBe(8)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('skips top-up in dry-run even when balance is low', async () => {
    mockDb.providerWallet.findUnique.mockResolvedValueOnce({
      id: 'w-1',
      paidCreditBalance: 1,
      promoCreditBalance: 1,
      status: 'ACTIVE',
    })

    const result = await ensureFannieHasCredits('prov-1', 5, 10, false)
    expect(result.toppedUp).toBe(false)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('tops up via ledger when balance is below minimum', async () => {
    mockDb.providerWallet.findUnique
      .mockResolvedValueOnce({ id: 'w-1', paidCreditBalance: 1, promoCreditBalance: 1, status: 'ACTIVE' })
      .mockResolvedValueOnce({ id: 'w-1', paidCreditBalance: 1, promoCreditBalance: 11, status: 'ACTIVE' })
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => fn(mockDb))

    const result = await ensureFannieHasCredits('prov-1', 5, 10, true)
    expect(result.toppedUp).toBe(true)
    expect(result.creditsAdded).toBe(10)
    expect(result.totalBalance).toBe(12)
    expect(creditPromoCreditsInTransaction).toHaveBeenCalledWith(
      mockDb,
      'prov-1',
      10,
      expect.objectContaining({ referenceType: 'seed-script', isTestTransaction: true }),
    )
  })

  it('handles provider with no wallet (null → 0 balance)', async () => {
    mockDb.providerWallet.findUnique.mockResolvedValueOnce(null)

    const result = await ensureFannieHasCredits('prov-1', 5, 10, false)
    expect(result.totalBalance).toBe(0)
    expect(result.toppedUp).toBe(false)
  })
})

// ─── assertSafeToRun ─────────────────────────────────────────────────────────

describe('assertSafeToRun', () => {
  const originalEnv = process.env.ALLOW_TEST_DATA_IMPORT

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_TEST_DATA_IMPORT
    } else {
      process.env.ALLOW_TEST_DATA_IMPORT = originalEnv
    }
  })

  it('does not throw in dry-run regardless of env', () => {
    delete process.env.ALLOW_TEST_DATA_IMPORT
    expect(() => assertSafeToRun(false)).not.toThrow()
  })

  it('does not throw when ALLOW_TEST_DATA_IMPORT=true and commit=true', () => {
    process.env.ALLOW_TEST_DATA_IMPORT = 'true'
    expect(() => assertSafeToRun(true)).not.toThrow()
  })

  it('throws when commit=true and ALLOW_TEST_DATA_IMPORT is missing', () => {
    delete process.env.ALLOW_TEST_DATA_IMPORT
    expect(() => assertSafeToRun(true)).toThrow(/ALLOW_TEST_DATA_IMPORT/)
  })

  it('throws when commit=true and ALLOW_TEST_DATA_IMPORT=false', () => {
    process.env.ALLOW_TEST_DATA_IMPORT = 'false'
    expect(() => assertSafeToRun(true)).toThrow(/ALLOW_TEST_DATA_IMPORT/)
  })
})
