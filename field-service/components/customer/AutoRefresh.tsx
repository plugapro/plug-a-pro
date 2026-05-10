'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export const POLL_INTERVAL_MS = 15_000

export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    function tick() {
      if (document.visibilityState === 'visible') {
        router.refresh()
      }
    }

    function startTimer() {
      if (timer) clearInterval(timer)
      timer = setInterval(tick, POLL_INTERVAL_MS)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        router.refresh()
        startTimer() // reset the 15s countdown so timer and focus never double-fire
      }
    }

    startTimer()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    // router is a stable singleton in Next.js App Router — including it in deps
    // is safe (cleanup+restart fires if it ever changes) but won't happen in practice
  }, [router])

  return null
}
