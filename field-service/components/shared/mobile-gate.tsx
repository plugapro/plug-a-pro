'use client'

// Blocks desktop viewport access to the customer PWA.
// Renders children on mobile; shows a redirect message on wider screens.

import { useEffect, useState } from 'react'
import { AppLogo } from './app-logo'

const MOBILE_BREAKPOINT = 768

export function MobileGate({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`)
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Don't block on SSR — only apply once JS hydrates
  if (!mounted) return <>{children}</>

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
