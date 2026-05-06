'use client'

// Enforces a mobile-first experience for engagement routes.
// Desktop users are shown a focused landing screen telling them to use
// a phone or tablet, because the product flows are designed for touch-first use.

import { useSyncExternalStore } from 'react'

const DESKTOP_BLOCK_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)'

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(DESKTOP_BLOCK_QUERY)
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_BLOCK_QUERY).matches
}

function getIsIpadUserAgent() {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /iPad/i.test(navigator.userAgent)
}

export function MobileGate({ children }: { children: React.ReactNode }) {
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const isIpad = getIsIpadUserAgent()

  if (isDesktop && !isIpad) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
          <div className="rounded-2xl border border-border bg-card/80 p-8 text-center shadow-sm">
            <p className="mb-3 rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
              Mobile-only platform
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Please use mobile for Plug-A-Pro
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Plug-A-Pro is designed for phones and tablets. For the best, safer
              experience, open this link on a mobile device.
            </p>
            <p className="mt-6 rounded border border-dashed border-border/70 px-4 py-3 text-xs text-muted-foreground">
              Customer, provider, admin, and service workflows are mobile-only.
              Your desktop session is currently blocked to protect the PWA-first
              journey.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return children
}
