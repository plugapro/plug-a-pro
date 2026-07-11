import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// metaFetch is the timeout+retry wrapper around Meta Graph API sends. We test it
// in isolation by stubbing global.fetch. It must NOT retry on a real HTTP error
// response (fetch resolves), only on a thrown network/timeout error.
import { metaFetch } from '@/lib/whatsapp'

describe('metaFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // AbortSignal.timeout exists in Node 18+/edge, but stub it deterministically.
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('passes an abort signal (timeout) to fetch', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await metaFetch('https://graph.facebook.com/x', { method: 'POST' })
    expect(AbortSignal.timeout).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]).toHaveProperty('signal')
  })

  it('does NOT retry on a real HTTP error response (4xx/5xx resolve, not throw)', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":131}}', { status: 400 }))
    const res = await metaFetch('https://graph.facebook.com/x', { method: 'POST' })
    expect(res.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on a thrown network/timeout error, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const res = await metaFetch('https://graph.facebook.com/x', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up and rethrows after two failed attempts', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    await expect(metaFetch('https://graph.facebook.com/x', { method: 'POST' })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
