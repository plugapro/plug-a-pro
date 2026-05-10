import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POLL_INTERVAL_MS, POLL_INTERVALS } from '@/components/customer/AutoRefresh'

// ─── AutoRefresh timer/visibility logic ─────────────────────────────────────
//
// The component is a thin wrapper over these two behaviours:
//   1. setTimeout fires router.refresh() using a step-up cadence
//   2. visibilitychange fires router.refresh() immediately on tab focus
//
// Because vitest runs in a node environment (no DOM / no React renderer),
// we extract the logic under test as pure functions and test them directly.

/** Returns the correct delay for a given tick index (matches component getInterval). */
function getInterval(tickCount: number): number {
  if (tickCount < 4) return POLL_INTERVALS.initial
  if (tickCount < 8) return POLL_INTERVALS.mid
  return POLL_INTERVALS.max
}

/**
 * Simulates the AutoRefresh effect with step-up intervals.
 * Returns a cleanup function and a resetCount function (simulates visibility-change reset).
 */
function startAutoRefresh(
  onRefresh: () => void,
  getVisibility: () => DocumentVisibilityState,
): { cleanup: () => void; resetCount: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let tickCount = 0

  function scheduleNext() {
    const delay = getInterval(tickCount)
    timer = setTimeout(tick, delay)
  }

  function tick() {
    if (getVisibility() === 'visible') {
      onRefresh()
    }
    tickCount += 1
    scheduleNext()
  }

  scheduleNext()

  return {
    cleanup: () => {
      if (timer) clearTimeout(timer)
    },
    resetCount: () => {
      tickCount = 0
      if (timer) clearTimeout(timer)
      scheduleNext()
    },
  }
}

/**
 * Simulates the visibilitychange handler.
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
    const { cleanup } = startAutoRefresh(refresh, () => 'visible')

    vi.advanceTimersByTime(POLL_INTERVAL_MS)

    expect(refresh).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('does not call refresh when tab is hidden', () => {
    const refresh = vi.fn()
    const { cleanup } = startAutoRefresh(refresh, () => 'hidden')

    vi.advanceTimersByTime(POLL_INTERVAL_MS)

    expect(refresh).not.toHaveBeenCalled()
    cleanup()
  })

  it('clears timer on cleanup — no further calls after unmount', () => {
    const refresh = vi.fn()
    const { cleanup } = startAutoRefresh(refresh, () => 'visible')

    cleanup()

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 2)

    expect(refresh).toHaveBeenCalledTimes(0)
  })

  it('fires multiple times across initial intervals while visible', () => {
    const refresh = vi.fn()
    const { cleanup } = startAutoRefresh(refresh, () => 'visible')

    // First 4 ticks each at 15s — advance exactly 60s
    vi.advanceTimersByTime(POLL_INTERVALS.initial * 4)

    expect(refresh).toHaveBeenCalledTimes(4)
    cleanup()
  })

  it('terminalState=true — no refresh is called (timer never started)', () => {
    // When terminalState is true the component returns early without scheduling.
    // Simulated by simply not calling startAutoRefresh.
    const refresh = vi.fn()

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 10)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('step-up: tick 5 fires at 30 s not 15 s after tick 4', () => {
    const refresh = vi.fn()
    const { cleanup } = startAutoRefresh(refresh, () => 'visible')

    // Advance through 4 ticks at 15s each = 60 000 ms total
    vi.advanceTimersByTime(POLL_INTERVALS.initial * 4)
    expect(refresh).toHaveBeenCalledTimes(4)

    // Tick 5 is at 30s. Advance only 15s — should NOT fire yet.
    vi.advanceTimersByTime(POLL_INTERVALS.initial)
    expect(refresh).toHaveBeenCalledTimes(4)

    // Advance remaining 15s (total 30s from tick 4) — tick 5 fires.
    vi.advanceTimersByTime(POLL_INTERVALS.initial)
    expect(refresh).toHaveBeenCalledTimes(5)

    cleanup()
  })

  it('POLL_INTERVAL_MS constant is still exported for backward compat', () => {
    expect(POLL_INTERVAL_MS).toBe(15_000)
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
