'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export const POLL_INTERVAL_MS = 15_000

export const POLL_INTERVALS = {
  initial: 15_000,
  mid: 30_000,
  max: 60_000,
} as const

function getInterval(tickCount: number): number {
  if (tickCount < 4) return POLL_INTERVALS.initial  // ticks 0-3: 15s
  if (tickCount < 8) return POLL_INTERVALS.mid       // ticks 4-7: 30s
  return POLL_INTERVALS.max                           // tick 8+:   60s
}

export function AutoRefresh({ terminalState = false }: { terminalState?: boolean }) {
  const router = useRouter()
  const tickCountRef = useRef(0)

  useEffect(() => {
    if (terminalState) return

    let timer: ReturnType<typeof setTimeout> | null = null

    function scheduleNext() {
      const delay = getInterval(tickCountRef.current)
      timer = setTimeout(tick, delay)
    }

    function tick() {
      if (document.visibilityState === 'visible') {
        router.refresh()
      }
      tickCountRef.current += 1
      scheduleNext()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        tickCountRef.current = 0
        if (timer) clearTimeout(timer)
        router.refresh()
        scheduleNext()
      }
    }

    scheduleNext()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [router, terminalState])

  return null
}
