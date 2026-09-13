import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAfter } = vi.hoisted(() => ({ mockAfter: vi.fn() }))
vi.mock('next/server', () => ({ after: mockAfter }))

import { runAfterResponse } from '../../lib/run-after-response'

describe('runAfterResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAfter.mockReset()
    mockAfter.mockImplementation(() => undefined)
  })

  it('hands the work to after() instead of leaving a floating promise', async () => {
    const work = vi.fn().mockResolvedValue('sent')

    const result = await runAfterResponse('post-match-acceptance', work)

    expect(result.mode).toBe('after')
    expect(mockAfter).toHaveBeenCalledTimes(1)
    // Registered, not yet run: after() owns when it executes.
    expect(work).not.toHaveBeenCalled()

    await (mockAfter.mock.calls[0]![0] as () => Promise<void>)()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('runs the work inline when after() is unavailable', async () => {
    mockAfter.mockImplementation(() => {
      throw new Error('after() called outside a request scope')
    })
    const work = vi.fn().mockResolvedValue(undefined)

    const result = await runAfterResponse('cron-context', work)

    expect(result.mode).toBe('inline')
    expect(result.ok).toBe(true)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('never throws when the work fails, and reports it', async () => {
    mockAfter.mockImplementation(() => {
      throw new Error('no request scope')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const work = vi.fn().mockRejectedValue(new Error('whatsapp 401'))

    const result = await runAfterResponse('post-match-acceptance', work)

    expect(result.ok).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      '[after-response] deferred work failed',
      expect.objectContaining({ label: 'post-match-acceptance', error: 'whatsapp 401' }),
    )
    consoleError.mockRestore()
  })

  it('swallows a failure inside the after() callback so the platform sees no error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const work = vi.fn().mockRejectedValue(new Error('boom'))

    await runAfterResponse('post-match-introductions', work)
    const callback = mockAfter.mock.calls[0]![0] as () => Promise<void>

    await expect(callback()).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('runs the work exactly once', async () => {
    const work = vi.fn().mockResolvedValue(undefined)
    await runAfterResponse('once', work)
    await (mockAfter.mock.calls[0]![0] as () => Promise<void>)()
    expect(work).toHaveBeenCalledTimes(1)
  })
})
