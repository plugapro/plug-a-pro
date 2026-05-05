import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock Prisma client to simulate Conversation.data persistence ────────────

const mockState = {
  conversation: null as null | { phone: string; data: Record<string, unknown> },
}

// Serialize $transaction calls to mirror Postgres serializable isolation —
// the real Prisma $transaction with row-locking is atomic, so the test mock
// must be too. Concurrent calls queue up rather than racing on shared state.
let txQueue: Promise<unknown> = Promise.resolve()

const mockTx = {
  conversation: {
    findUnique: vi.fn(async ({ where }: { where: { phone: string } }) => {
      if (!mockState.conversation || mockState.conversation.phone !== where.phone) return null
      return { data: mockState.conversation.data }
    }),
    update: vi.fn(async ({ where, data }: { where: { phone: string }; data: { data: Record<string, unknown> } }) => {
      if (mockState.conversation && mockState.conversation.phone === where.phone) {
        mockState.conversation.data = data.data
      }
      return { id: 'conv-1' }
    }),
  },
}

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      // Chain onto the queue so concurrent transactions serialize.
      const next = txQueue.then(() => fn(mockTx))
      txQueue = next.catch(() => undefined)
      return next
    },
    conversation: {
      findUnique: vi.fn(async ({ where }: { where: { phone: string } }) => {
        if (!mockState.conversation || mockState.conversation.phone !== where.phone) return null
        return { data: mockState.conversation.data }
      }),
      update: vi.fn(async ({ where, data }: { where: { phone: string }; data: { data: Record<string, unknown> } }) => {
        if (mockState.conversation && mockState.conversation.phone === where.phone) {
          mockState.conversation.data = data.data
        }
        return { id: 'conv-1' }
      }),
    },
  },
}))

beforeEach(() => {
  mockState.conversation = { phone: '+27821234567', data: {} }
  txQueue = Promise.resolve()
  vi.clearAllMocks()
})

describe('claimMediaBatchSeq', () => {
  it('returns 1 on first call, 2 on second, etc — atomic monotonic per scope', async () => {
    const { claimMediaBatchSeq } = await import('@/lib/whatsapp-media-batch')
    expect(await claimMediaBatchSeq('+27821234567', 'provider_evidence')).toBe(1)
    expect(await claimMediaBatchSeq('+27821234567', 'provider_evidence')).toBe(2)
    expect(await claimMediaBatchSeq('+27821234567', 'provider_evidence')).toBe(3)
  })

  it('keeps separate counters per scope', async () => {
    const { claimMediaBatchSeq } = await import('@/lib/whatsapp-media-batch')
    expect(await claimMediaBatchSeq('+27821234567', 'provider_evidence')).toBe(1)
    expect(await claimMediaBatchSeq('+27821234567', 'customer_photo')).toBe(1)
    expect(await claimMediaBatchSeq('+27821234567', 'provider_evidence')).toBe(2)
    expect(await claimMediaBatchSeq('+27821234567', 'customer_photo')).toBe(2)
  })

  it('does not crash when conversation row does not yet exist', async () => {
    mockState.conversation = null
    const { claimMediaBatchSeq } = await import('@/lib/whatsapp-media-batch')
    // Without a row to update, sequence falls through to 1 each call but
    // should not throw — protects against a race where the conversation hasn't
    // been created yet.
    const seq = await claimMediaBatchSeq('+27821234567', 'provider_evidence')
    expect(seq).toBe(1)
  })
})

describe('awaitAndCheckLatest', () => {
  it('returns true when no newer event arrived during the wait', async () => {
    const { claimMediaBatchSeq, awaitAndCheckLatest } = await import('@/lib/whatsapp-media-batch')
    const mySeq = await claimMediaBatchSeq('+27821234567', 'provider_evidence')
    // Use a tiny debounce so the test is fast.
    expect(await awaitAndCheckLatest('+27821234567', 'provider_evidence', mySeq, 5)).toBe(true)
  })

  it('returns false when a newer event claims a higher seq during the wait', async () => {
    const { claimMediaBatchSeq, awaitAndCheckLatest } = await import('@/lib/whatsapp-media-batch')
    const mySeq = await claimMediaBatchSeq('+27821234567', 'provider_evidence')
    // Simulate a newer event happening during the debounce window.
    setTimeout(() => {
      void claimMediaBatchSeq('+27821234567', 'provider_evidence')
    }, 1)
    expect(await awaitAndCheckLatest('+27821234567', 'provider_evidence', mySeq, 30)).toBe(false)
  })
})

describe('debounceMediaBatch — regression: 5 concurrent events → only latest is "isLatest"', () => {
  it('exactly one of N concurrent events is reported as the latest', async () => {
    const { debounceMediaBatch } = await import('@/lib/whatsapp-media-batch')
    const N = 5
    // Fire N concurrent events with a tiny debounce so the test is fast.
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        debounceMediaBatch({ phone: '+27821234567', scope: 'provider_evidence', debounceMs: 30 })
      )
    )
    const latest = results.filter((r) => r.isLatest)
    expect(latest).toHaveLength(1)
    // The latest must be the highest-numbered seq.
    const maxSeq = Math.max(...results.map((r) => r.mySeq))
    expect(latest[0].mySeq).toBe(maxSeq)
  })

  it('a single event becomes "isLatest" — confirms single-file uploads still respond', async () => {
    const { debounceMediaBatch } = await import('@/lib/whatsapp-media-batch')
    const result = await debounceMediaBatch({
      phone: '+27821234567',
      scope: 'provider_evidence',
      debounceMs: 5,
    })
    expect(result.isLatest).toBe(true)
    expect(result.mySeq).toBe(1)
  })
})

describe('WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS', () => {
  it('exposes a positive default debounce window', async () => {
    const { WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS } = await import('@/lib/whatsapp-media-batch')
    expect(WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS).toBeGreaterThan(0)
  })
})
