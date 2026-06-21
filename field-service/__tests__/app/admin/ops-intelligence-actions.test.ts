import { vi, it, expect, describe, beforeEach } from 'vitest'

// Captures the data passed to the draft/recommendation update calls so we can
// assert the critical "approve does NOT send" invariant.
const calls: { draftUpdate?: Record<string, unknown>; recUpdate?: Record<string, unknown> } = {}

// The status the draft is in when loaded — tests vary it to exercise the guard.
let draftStatus = 'PENDING_APPROVAL'

const mockTx = () => ({
  opsDraftMessage: {
    findUniqueOrThrow: vi.fn(async () => ({
      id: 'draft-1',
      status: draftStatus,
      recommendationId: 'rec-1',
      recipientRole: 'PROVIDER',
      recommendation: { agentKey: 'PROVIDER_APPLICATION_REVIEW' },
    })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.draftUpdate = data
      return { id: 'draft-1', recommendationId: 'rec-1', recipientRole: 'PROVIDER' }
    }),
  },
  opsRecommendation: {
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.recUpdate = data
      return { id: 'rec-1', agentKey: 'PROVIDER_APPLICATION_REVIEW', entityType: 'PROVIDER_APPLICATION', entityId: 'app-1' }
    }),
  },
  auditLog: { create: vi.fn() },
  adminAuditEvent: { create: vi.fn() },
})

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'OPS', active: true }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx())),
  },
}))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'OPS' }),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { isEnabled } from '@/lib/flags'

const captureDraftDecision = vi.fn(async (_input: Record<string, unknown>) => {})
const captureReview = vi.fn(async (_input: Record<string, unknown>) => {})
vi.mock('@/lib/ops-agents', () => ({
  captureDraftDecision: (input: Record<string, unknown>) => captureDraftDecision(input),
  captureReview: (input: Record<string, unknown>) => captureReview(input),
  runAgent: vi.fn(async () => ({ status: 'SUCCESS' })),
}))
vi.mock('@/lib/ops-agents/agents', () => ({ PHASE_1_AGENTS: [] }))

beforeEach(() => {
  vi.clearAllMocks()
  calls.draftUpdate = undefined
  calls.recUpdate = undefined
  draftStatus = 'PENDING_APPROVAL'
  vi.mocked(isEnabled).mockResolvedValue(true)
})

describe('decideDraftAction', () => {
  it('APPROVE sets status APPROVED (never SENT) and logs an approval to OpenBrain', async () => {
    const { decideDraftAction } = await import('@/app/(admin)/admin/ops-intelligence/actions')
    const result = await decideDraftAction({ draftId: 'draft-1', decision: 'APPROVE' })

    expect(result.ok).toBe(true)
    expect(calls.draftUpdate?.status).toBe('APPROVED')
    expect(calls.draftUpdate?.status).not.toBe('SENT')
    expect(calls.draftUpdate?.approvedById).toBe('admin-1')
    expect(captureDraftDecision).toHaveBeenCalledTimes(1)
    expect(captureDraftDecision.mock.calls[0][0]).toMatchObject({ decision: 'approved' })
  })

  it('REJECT sets status REJECTED and records the reason', async () => {
    const { decideDraftAction } = await import('@/app/(admin)/admin/ops-intelligence/actions')
    const result = await decideDraftAction({ draftId: 'draft-1', decision: 'REJECT', reason: 'off tone' })

    expect(result.ok).toBe(true)
    expect(calls.draftUpdate?.status).toBe('REJECTED')
    expect(calls.draftUpdate?.failureReason).toBe('off tone')
    expect(captureDraftDecision.mock.calls[0][0]).toMatchObject({ decision: 'rejected' })
  })

  it('refuses to re-decide a draft that is not PENDING_APPROVAL (no write)', async () => {
    draftStatus = 'APPROVED'
    const { decideDraftAction } = await import('@/app/(admin)/admin/ops-intelligence/actions')
    await expect(decideDraftAction({ draftId: 'draft-1', decision: 'APPROVE' })).rejects.toThrow()
    expect(calls.draftUpdate).toBeUndefined()
  })

  it('is blocked when the admin.ops_intelligence flag is disabled (no write)', async () => {
    vi.mocked(isEnabled).mockResolvedValue(false)
    const { decideDraftAction } = await import('@/app/(admin)/admin/ops-intelligence/actions')
    await expect(decideDraftAction({ draftId: 'draft-1', decision: 'APPROVE' })).rejects.toThrow()
    expect(calls.draftUpdate).toBeUndefined()
  })
})

describe('reviewRecommendationAction', () => {
  it('records the decision + reviewer and logs the review to OpenBrain', async () => {
    const { reviewRecommendationAction } = await import('@/app/(admin)/admin/ops-intelligence/actions')
    const result = await reviewRecommendationAction({ recommendationId: 'rec-1', decision: 'ACTIONED', note: 'handled' })

    expect(result.ok).toBe(true)
    expect(calls.recUpdate?.status).toBe('ACTIONED')
    expect(calls.recUpdate?.reviewedById).toBe('admin-1')
    expect(calls.recUpdate?.reviewNote).toBe('handled')
    expect(captureReview).toHaveBeenCalledTimes(1)
    expect(captureReview.mock.calls[0][0]).toMatchObject({ decision: 'ACTIONED', adminId: 'admin-1' })
  })
})
