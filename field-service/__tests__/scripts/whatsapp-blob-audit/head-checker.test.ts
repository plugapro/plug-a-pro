import { describe, it, expect, vi } from 'vitest'
import { headCheckAll } from '@/scripts/whatsapp-blob-audit/head-checker'
import type { AttachmentRow } from '@/scripts/whatsapp-blob-audit/types'

const mk = (id: string, url: string): AttachmentRow => ({ id, mediaId: id, url, label: null, parentKind: null, parentId: null })

describe('headCheckAll', () => {
  it('returns alive for 200, dead for 404, error for thrown', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('ok')) return { ok: true, status: 200 } as Response
      if (url.includes('miss')) return { ok: false, status: 404 } as Response
      throw new Error('network')
    }) as unknown as typeof fetch
    const results = await headCheckAll(
      [mk('a', 'https://blob/ok'), mk('b', 'https://blob/miss'), mk('c', 'https://blob/err')],
      { fetcher, concurrency: 3, timeoutMs: 1000 },
    )
    const byId = Object.fromEntries(results.map((r) => [r.attachmentId, r]))
    expect(byId.a.status).toBe('alive')
    expect(byId.a.httpStatus).toBe(200)
    expect(byId.b.status).toBe('dead')
    expect(byId.b.httpStatus).toBe(404)
    expect(byId.c.status).toBe('error')
    expect(byId.c.errorMessage).toBe('network')
  })

  it('respects the concurrency limit', async () => {
    let inFlight = 0
    let maxSeen = 0
    const fetcher = vi.fn(async () => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return { ok: true, status: 200 } as Response
    }) as unknown as typeof fetch
    const rows = Array.from({ length: 10 }).map((_, i) => mk(`a${i}`, `https://blob/${i}`))
    await headCheckAll(rows, { fetcher, concurrency: 3, timeoutMs: 1000 })
    expect(maxSeen).toBeLessThanOrEqual(3)
  })

  it('marks requests that exceed timeoutMs as error', async () => {
    const fetcher = vi.fn(async (_url: string, opts?: RequestInit) => {
      const signal = opts?.signal as AbortSignal | undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }) as unknown as typeof fetch
    const results = await headCheckAll([mk('a', 'https://slow')], { fetcher, concurrency: 1, timeoutMs: 20 })
    expect(results[0].status).toBe('error')
    expect(results[0].errorMessage).toContain('abort')
  })
})
