import { vi, it, expect, describe, beforeEach } from 'vitest'

const makeMockCase = () => ({
  id: 'case-1',
  state: 'OPEN',
  ownerUserId: null,
  queueType: 'DISPATCH',
  entityType: 'JOB_REQUEST',
  entityId: 'jr-1',
  slaDueAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
})

const mockTx = () => ({
  case: {
    findUnique: vi.fn().mockResolvedValue(makeMockCase()),
    update: vi.fn().mockResolvedValue({ ...makeMockCase(), ownerUserId: 'admin-1' }),
  },
  caseEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
  caseNote: { create: vi.fn().mockResolvedValue({ id: 'note-1' }) },
  auditLog: { create: vi.fn() },
  adminAuditEvent: { create: vi.fn() },
})

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN', active: true }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx())),
  },
}))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'OPS' }),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

beforeEach(() => { vi.clearAllMocks() })

describe('claimCaseAction', () => {
  it('returns ok:true when case exists', async () => {
    const { claimCaseAction } = await import('@/app/(admin)/admin/_actions/case/index')
    const result = await claimCaseAction('case-1')
    expect(result.ok).toBe(true)
  })
})

describe('resolveCaseAction', () => {
  it('returns ok:true with outcome and reason code', async () => {
    const { resolveCaseAction } = await import('@/app/(admin)/admin/_actions/case/index')
    const result = await resolveCaseAction({
      caseId: 'case-1',
      outcome: 'Resolved by reassignment',
      reasonCode: 'COVERAGE_GAP',
      note: 'Provider was reassigned manually',
    })
    expect(result.ok).toBe(true)
  })

  it('requires note when reasonCode is OTHER', async () => {
    const { resolveCaseAction } = await import('@/app/(admin)/admin/_actions/case/index')
    await expect(
      resolveCaseAction({ caseId: 'case-1', outcome: 'x', reasonCode: 'OTHER', note: '' })
    ).rejects.toThrow('note is required')
  })
})
