import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── AutoRefresh timer/visibility logic ─────────────────────────────────────
//
// The component is a thin wrapper over these two behaviours:
//   1. setInterval fires router.refresh() every 15 s when tab is visible
//   2. visibilitychange fires router.refresh() immediately on tab focus
//
// Because vitest runs in a node environment (no DOM / no React renderer),
// we extract the logic under test as pure functions and test them directly.
// This mirrors the pattern used by other component tests in this directory.

const POLL_INTERVAL_MS = 15_000

/**
 * Simulates the AutoRefresh effect:
 * - Starts an interval that calls `onRefresh` when `getVisibility()` is 'visible'
 * - Returns a cleanup function that cancels the interval
 */
function startAutoRefresh(
  onRefresh: () => void,
  getVisibility: () => DocumentVisibilityState,
): () => void {
  const timer = setInterval(() => {
    if (getVisibility() === 'visible') {
      onRefresh()
    }
  }, POLL_INTERVAL_MS)

  return () => {
    clearInterval(timer)
  }
}

/**
 * Simulates the visibilitychange handler:
 * - Calls `onRefresh` immediately when the tab becomes visible
 */
function handleVisibilityChange(
  onRefresh: () => void,
  getVisibility: () => DocumentVisibilityState,
): void {
  if (getVisibility() === 'visible') {
    onRefresh()
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AutoRefresh timer logic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls refresh after 15 s when tab is visible', () => {
    const refresh = vi.fn()
    const cleanup = startAutoRefresh(refresh, () => 'visible')

    vi.advanceTimersByTime(POLL_INTERVAL_MS)

    expect(refresh).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('does not call refresh when tab is hidden', () => {
    const refresh = vi.fn()
    const cleanup = startAutoRefresh(refresh, () => 'hidden')

    vi.advanceTimersByTime(POLL_INTERVAL_MS)

    expect(refresh).not.toHaveBeenCalled()
    cleanup()
  })

  it('clears interval on cleanup — no further calls after unmount', () => {
    const refresh = vi.fn()
    const cleanup = startAutoRefresh(refresh, () => 'visible')

    cleanup() // simulate unmount

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 2)

    expect(refresh).toHaveBeenCalledTimes(0)
  })

  it('fires multiple times across intervals while visible', () => {
    const refresh = vi.fn()
    const cleanup = startAutoRefresh(refresh, () => 'visible')

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)

    expect(refresh).toHaveBeenCalledTimes(3)
    cleanup()
  })
})

describe('AutoRefresh visibilitychange handler', () => {
  it('triggers refresh when tab becomes visible', () => {
    const refresh = vi.fn()
    handleVisibilityChange(refresh, () => 'visible')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not trigger refresh when tab is hidden', () => {
    const refresh = vi.fn()
    handleVisibilityChange(refresh, () => 'hidden')
    expect(refresh).not.toHaveBeenCalled()
  })
})
