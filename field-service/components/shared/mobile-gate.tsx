'use client'

// Shows a dismissible banner on desktop viewports instead of blocking access.
// The banner reminds users the app is optimised for mobile without preventing use.

import { useSyncExternalStore, useState } from 'react'

const MOBILE_BREAKPOINT = 768
const SESSION_KEY = 'pap:mobile-banner-dismissed'

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`)
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`).matches
}

// Read sessionStorage in the lazy initializer so no setState-in-useEffect is needed.
// Returns true (hidden) during SSR where window is undefined, preventing hydration mismatches.
function getInitialDismissed(): boolean {
  if (typeof window === 'undefined') return true
  return sessionStorage.getItem(SESSION_KEY) === '1'
}

export function MobileGate({ children }: { children: React.ReactNode }) {
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const [dismissed, setDismissed] = useState(getInitialDismissed)

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, '1')
    setDismissed(true)
  }

  return (
    <>
      {isDesktop && !dismissed && (
        <div className="flex items-center justify-between gap-4 bg-muted border-b border-border px-4 py-2 text-sm text-muted-foreground">
          <span>
            Plug A Pro works best on mobile. Scan the QR code or open this link on your phone for the full experience.
          </span>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded px-2 py-0.5 text-xs hover:bg-muted-foreground/10 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      {children}
    </>
  )
}
