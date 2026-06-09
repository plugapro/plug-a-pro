import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCrudAction, mockListNudgeCandidates } = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockListNudgeCandidates: vi.fn(),
}))

class MockCrudActionError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CrudActionError'
    this.code = code
  }
}

vi.mock('@/lib/crud-action', () => ({
  crudAction: mockCrudAction,
  CrudActionError: MockCrudActionError,
}))

vi.mock('@/lib/nudges/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nudges/queue')>(
    '@/lib/nudges/queue',
  )
  return {
    ...actual,
    listNudgeCandidates: mockListNudgeCandidates,
    NUDGE_MARK_SENT_BATCH_CAP: 5, // small cap for testability
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const FAKE_CANDIDATE = {
  providerId: 'p1',
  name: 'Test',
  phone: '+27821234567',
  email: 't@example.com',
  tier: 'R5' as const,
  skills: ['plumbing'],
  serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
  missingItems: ['bank details'],
  missingItemsLabel: 'bank details',
  renderedMessage: 'Hi Test, …',
  lastNudgedAt: null,
  applicationStatus: null,
}

describe('admin/nudges actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListNudgeCandidates.mockResolvedValue([FAKE_CANDIDATE])
    // Default: crudAction runs the closure with no DB tx, returns { ok, data }.
    mockCrudAction.mockImplementation(async (opts: any) => {
      const data = await opts.run(opts.input, {} as any)
      return { ok: true as const, data }
    })
  })

  it('previewNudgeAction writes nudge.preview.viewed audit and returns the rendered message', async () => {
    const { previewNudgeAction } = await import(
      '@/app/(admin)/admin/nudges/actions'
    )

    const result = await previewNudgeAction({ providerId: 'p1' })

    expect(mockCrudAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'nudge.preview.viewed',
        requiredFlag: 'launch.west_rand_pilot.nudge_console',
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.renderedMessage).toContain('Hi Test')
    }
  })

  it('exportNudgeQueueCsvAction writes nudge.csv.exported with rowCount + filter metadata', async () => {
    const { exportNudgeQueueCsvAction } = await import(
      '@/app/(admin)/admin/nudges/actions'
    )

    const result = await exportNudgeQueueCsvAction({
      suburbSlug: null,
      categorySlug: 'plumbing',
      tier: null,
    })

    expect(mockCrudAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'nudge.csv.exported',
        requiredFlag: 'launch.west_rand_pilot.nudge_console',
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.csv).toContain('provider_id')
      expect(result.data.rowCount).toBe(1)
    }
  })

  it('markNudgeBatchSentAction writes nudge.batch.marked_sent on a valid batch', async () => {
    const { markNudgeBatchSentAction } = await import(
      '@/app/(admin)/admin/nudges/actions'
    )

    const result = await markNudgeBatchSentAction({
      providerIds: ['p1', 'p2'],
      batchNote: 'Sent via WhatsApp Business 10:30',
      confirmPhrase: 'mark-sent-2',
    })

    expect(mockCrudAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'nudge.batch.marked_sent',
        requiredFlag: 'launch.west_rand_pilot.nudge_console',
      }),
    )
    expect(result.ok).toBe(true)
  })

  describe('markNudgeBatchSentAction guards', () => {
    it('rejects confirm-phrase mismatch before crudAction', async () => {
      const { markNudgeBatchSentAction } = await import(
        '@/app/(admin)/admin/nudges/actions'
      )

      const result = await markNudgeBatchSentAction({
        providerIds: ['p1'],
        batchNote: null,
        confirmPhrase: 'wrong',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('confirm-phrase-mismatch')
      }
      expect(mockCrudAction).not.toHaveBeenCalled()
    })

    it('rejects an empty batch before crudAction', async () => {
      const { markNudgeBatchSentAction } = await import(
        '@/app/(admin)/admin/nudges/actions'
      )

      const result = await markNudgeBatchSentAction({
        providerIds: [],
        batchNote: null,
        confirmPhrase: 'mark-sent-0',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('empty-batch')
      }
      expect(mockCrudAction).not.toHaveBeenCalled()
    })

    it('rejects an oversized batch before crudAction', async () => {
      const { markNudgeBatchSentAction } = await import(
        '@/app/(admin)/admin/nudges/actions'
      )

      const result = await markNudgeBatchSentAction({
        providerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], // > cap of 5
        batchNote: null,
        confirmPhrase: 'mark-sent-6',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('batch-oversized')
      }
      expect(mockCrudAction).not.toHaveBeenCalled()
    })
  })
})
