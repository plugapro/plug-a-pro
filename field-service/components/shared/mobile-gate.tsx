'use client'

// Enforces a mobile-first experience for engagement routes.
// Desktop users are shown a focused landing screen telling them to use
// a phone or tablet, because the product flows are designed for touch-first use.

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'

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

function getIsTabletUserAgent() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const ua = navigator.userAgent.toLowerCase()

  // Covers common Android and iOS tablet UAs.
  if (/ipad|tablet|silk|playbook|kf[a-z]{2}|sm-t|gt-p|nexus 7|nexus 10|xoom|sm-t/.test(ua)) {
    return true
  }

  // Android tablets often omit "mobile", while phones keep it.
  if (/android/.test(ua) && !/mobile/.test(ua)) {
    return true
  }

  return false
}

function normalizeHost(host: string) {
  const lower = host.trim().toLowerCase()
  return lower.replace(/:\d+$/, '')
}

export function isDesktopAdminBypassPath(params: {
  pathname: string | null
  host: string | null
}) {
  const pathname = params.pathname ?? ''
  const host = normalizeHost(params.host ?? '')

  if (host === 'admin.plugapro.co.za') return true
if (pathname === '/admin' || pathname.startsWith('/admin/')) return true
  return false
}

export function MobileGate({ children }: { children: React.ReactNode }) {
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const pathname = usePathname()
  const isIpad = getIsIpadUserAgent()
  const isTablet = getIsTabletUserAgent()
  const host = typeof window === 'undefined' ? null : window.location.host
  const desktopAdminBypass = isDesktopAdminBypassPath({ pathname, host })

  if (isDesktop && !isIpad && !isTablet && !desktopAdminBypass) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
          <div className="rounded-2xl border border-border bg-card/80 p-8 text-center shadow-sm">
            <p className="mb-3 rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
              Mobile-only platform
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Please use mobile for Plug A Pro
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Plug A Pro is designed for phones and tablets. For the best, safer
              experience, open this link on a mobile device.
            </p>
            <p className="mt-6 rounded border border-dashed border-border/70 px-4 py-3 text-xs text-muted-foreground">
              Customer and provider workflows are mobile-only. Use the dedicated
              admin domain for desktop operations access.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return children
}
