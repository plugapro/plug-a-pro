'use client'

// Blocks desktop viewport access to the customer PWA.
// Renders children on mobile; shows a redirect message on wider screens.

import { useSyncExternalStore } from 'react'
import { AppLogo } from './app-logo'

const MOBILE_BREAKPOINT = 768

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`)
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`).matches
}

export function MobileGate({ children }: { children: React.ReactNode }) {
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (isDesktop) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
        <AppLogo />
        <div className="max-w-sm space-y-3">
          <h1 className="text-xl font-semibold">Open this on your phone</h1>
          <p className="text-sm text-muted-foreground">
            Plug A Pro is designed for mobile. Scan the QR code or open this link on your smartphone to get started.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          app.plugapro.co.za
        </p>
      </div>
    )
  }

  return <>{children}</>
}
