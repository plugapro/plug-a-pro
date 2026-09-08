'use client'

// ─── Customer: Pay now CTA (Task 18) ────────────────────────────────────────
// Renders on the booking detail page whenever a live PSP checkout session
// exists (Payment.collectionMode === 'PLATFORM_CHECKOUT', status PENDING,
// checkoutUrl present). Outside the VodaPay mini-program this is exactly the
// pre-existing plain-redirect behaviour ("elsewhere unchanged" per the Task
// 18 brief) — inside it, tapping Pay opens the host bridge's tradePay()
// instead of navigating away, then polls the booking page's own server data
// until the webhook lands (or the 60s cap is hit).
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { performCheckout } from '@/lib/vodapay/checkout'

const POLL_INTERVAL_MS = 3_000
const POLL_CAP_MS = 60_000

export function PayNowCard({
  checkoutUrl,
  paymentStatus,
}: {
  checkoutUrl: string
  /** Payment.status as loaded server-side for this render. */
  paymentStatus: string
}) {
  const router = useRouter()
  const [polling, setPolling] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paid = paymentStatus === 'PAID'
  // A router.refresh() re-runs the server component tree, which hands this
  // component a fresh `paymentStatus` prop once the webhook has landed — stop
  // polling as soon as that happens (no separate effect needed: `isPolling`
  // itself flips to false, and the effect below tears down on that change).
  const isPolling = polling && !paid

  useEffect(() => {
    if (!isPolling) return

    intervalRef.current = setInterval(() => router.refresh(), POLL_INTERVAL_MS)
    timeoutRef.current = setTimeout(() => {
      setPolling(false)
      setTimedOut(true)
    }, POLL_CAP_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [isPolling, router])

  function handlePayNow() {
    setTimedOut(false)
    performCheckout(checkoutUrl, () => setPolling(true), {
      ua: navigator.userAgent,
      bridge: window.my,
      navigate: (url) => {
        window.location.href = url
      },
    })
  }

  if (paid) {
    return (
      <div
        className="rounded-[20px] p-4 flex items-center gap-3"
        style={{ background: 'rgba(15,162,138,0.06)', boxShadow: 'inset 0 0 0 1px rgba(15,162,138,0.2)' }}
      >
        <CreditCard size={18} style={{ color: '#0FA28A' }} />
        <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
          Payment confirmed
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[20px] p-4" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
      <div className="text-[13.5px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>
        Pay for this job
      </div>
      <p className="text-[12.5px] mb-3" style={{ color: 'var(--ink-mute)' }}>
        {polling
          ? 'Confirming your payment…'
          : 'Complete payment securely to finish booking this provider.'}
      </p>
      <Button
        type="button"
        className="w-full"
        onClick={handlePayNow}
        loading={polling}
        loadingLabel="Confirming payment…"
      >
        <CreditCard size={16} className="mr-1.5" />
        Pay now
      </Button>
      {timedOut && (
        <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-mute)' }}>
          Still confirming — this page will update automatically once the payment lands.
        </p>
      )}
    </div>
  )
}
