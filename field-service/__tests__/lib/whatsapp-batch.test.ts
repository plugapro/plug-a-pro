import { describe, it, expect, vi, afterEach } from 'vitest'
import { createBatchAccumulators } from '@/lib/whatsapp-batch'
import type { InboundMessage } from '@/lib/whatsapp-interactive'

const fakeMsg = (id: string): InboundMessage =>
  ({ id, from: '+27820000001', type: 'image', timestamp: '0' }) as InboundMessage

describe('createBatchAccumulators', () => {
  afterEach(() => vi.useRealTimers())

  it('accumulates messages and resolves all waiters when flushed', async () => {
    vi.useFakeTimers()
    const { customerPhotoBatches } = createBatchAccumulators()

    const phone = '+27820000001'
    const waiter1 = new Promise<void>((resolve, reject) => {
      const batch = customerPhotoBatches.get(phone) ?? {
        messages: [],
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
        waiters: [] as Array<{ resolve: () => void; reject: (e: unknown) => void }>,
      }
      batch.waiters.push({ resolve, reject })
      if (!customerPhotoBatches.has(phone)) customerPhotoBatches.set(phone, batch)
    })

    expect(customerPhotoBatches.has(phone)).toBe(true)
    customerPhotoBatches.get(phone)!.messages.push(fakeMsg('msg-1'))
    customerPhotoBatches.get(phone)!.waiters.forEach((w) => w.resolve())
    customerPhotoBatches.delete(phone)

    await expect(waiter1).resolves.toBeUndefined()
  })

  it('returns independent accumulators per call (no shared singleton state)', () => {
    const a = createBatchAccumulators()
    const b = createBatchAccumulators()
    a.customerPhotoBatches.set('+27820000001', {
      messages: [],
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
      waiters: [],
    })
    expect(b.customerPhotoBatches.has('+27820000001')).toBe(false)
  })
})
