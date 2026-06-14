'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { isSensitiveTokenRoute } from '@/lib/sensitive-token-routes'

// POPIA-aware Google Consent Mode v2 banner for the app. GA loads with consent
// defaulted to "denied" (see components/google-analytics.tsx), so no analytics/ad
// cookies are set until the visitor accepts here. Positioned above the bottom nav.

const STORAGE_KEY = 'pap_ga_consent'
type Choice = 'granted' | 'denied'
type GtagWindow = typeof window & { gtag?: (...args: unknown[]) => void }

function applyConsent(choice: Choice) {
  const w = window as GtagWindow
  if (typeof w.gtag !== 'function') return
  w.gtag('consent', 'update', {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  })
}

export function ConsentBanner() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {
      stored = null
    }
    if (stored === 'granted' || stored === 'denied') {
      applyConsent(stored)
      return
    }
    // Consent is unknown only on the client (localStorage); reveal in this mount
    // effect. Renders hidden on the server to match SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true)
  }, [])

  // No analytics runs on token routes, so no consent prompt there either.
  if (!visible || isSensitiveTokenRoute(pathname)) return null

  function choose(choice: Choice) {
    try {
      localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // ignore storage failures (private mode); the choice still applies this session
    }
    applyConsent(choice)
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 z-[60] px-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))]"
    >
      <div className="mx-auto flex max-w-md flex-col gap-2 rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          We use analytics cookies to improve Plug A Pro. None are set unless you accept.{' '}
          <a
            href="https://plugapro.co.za/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Privacy
          </a>
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => choose('denied')}>
            Decline
          </Button>
          <Button size="sm" onClick={() => choose('granted')}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
