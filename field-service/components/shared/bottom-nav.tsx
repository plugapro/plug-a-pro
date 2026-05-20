'use client'

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  resolveBottomNavAccountItem,
  type BottomNavAuthRole,
  type BottomNavAuthState,
} from "@/lib/bottom-nav-auth"
import { cn } from "@/lib/utils"

export interface BottomNavItem {
  id: string
  label: string
  icon: React.ReactNode
  href: string
  exact?: boolean
}

interface BottomNavProps {
  items: BottomNavItem[]
  className?: string
  authAwareAccount?: {
    accountItemId: string
    protectedPathPrefixes?: string[]
    signedOut: {
      label: string
      href: string
    }
    signedInCustomer: {
      label: string
      href: string
    }
    signedInProvider?: {
      label: string
      href: string
    }
    loading?: {
      label: string
      href: string
    }
    initialAuthState?: {
      authenticated: boolean
      role: BottomNavAuthRole
    } | null
  }
}

function BottomNav({ items, className, authAwareAccount }: BottomNavProps) {
  const pathname = usePathname()
  const [authState, setAuthState] = React.useState<BottomNavAuthState>(() => {
    if (!authAwareAccount) return { status: 'signed_out', role: null }
    if (!authAwareAccount.initialAuthState) return { status: 'loading', role: null }
    if (authAwareAccount.initialAuthState.authenticated) {
      return {
        status: 'signed_in',
        role: authAwareAccount.initialAuthState.role,
      }
    }
    const protectedPrefixes = authAwareAccount.protectedPathPrefixes ?? []
    const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    return isProtected
      ? { status: 'loading', role: null }
      : { status: 'signed_out', role: null }
  })

  React.useEffect(() => {
    if (!authAwareAccount) return

    let cancelled = false

    const refreshAuthState = async () => {
      try {
        const res = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) return

        const body = await res.json() as { authenticated?: boolean; role?: BottomNavAuthRole }
        if (cancelled) return

        if (body.authenticated) {
          setAuthState({
            status: 'signed_in',
            role: body.role ?? null,
          })
          return
        }

        setAuthState({
          status: 'signed_out',
          role: null,
        })
      } catch {
        // Keep the current server-provided state if the probe fails.
      }
    }

    void refreshAuthState()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshAuthState()
    }
    const onFocus = () => void refreshAuthState()
    const onAuthChanged = () => void refreshAuthState()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pap:auth-session-changed', onAuthChanged as EventListener)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pap:auth-session-changed', onAuthChanged as EventListener)
    }
  }, [authAwareAccount])

  const resolvedItems = React.useMemo(() => {
    if (!authAwareAccount) return items

    const protectedPathPrefixes = authAwareAccount.protectedPathPrefixes ?? []
    return items.map((item) => resolveBottomNavAccountItem(item, {
      accountItemId: authAwareAccount.accountItemId,
      auth: authState,
      pathname,
      protectedPathPrefixes,
      signedOutTarget: authAwareAccount.signedOut,
      signedInCustomerTarget: authAwareAccount.signedInCustomer,
      signedInProviderTarget: authAwareAccount.signedInProvider,
      loadingTarget: authAwareAccount.loading,
    }))
  }, [authAwareAccount, authState, items, pathname])

  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        "layer-sticky fixed bottom-0 left-0 right-0",
        "flex justify-around",
        "px-3 pt-2 pb-[calc(28px+env(safe-area-inset-bottom,0px))]",
        "bg-white/85 dark:bg-[rgba(11,11,16,0.85)]",
        "[backdrop-filter:blur(20px)_saturate(180%)] [-webkit-backdrop-filter:blur(20px)_saturate(180%)]",
        "shadow-[inset_0_1px_0_var(--border)]",
        className
      )}
    >
      {resolvedItems.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/")

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-1.5 px-1",
              "text-[11px] font-semibold leading-none tracking-[-0.01em]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)] rounded-lg",
              active ? "text-[var(--brand-purple)]" : "text-[var(--ink-mute)]",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-11 h-7 rounded-[14px]",
                "transition-[background-color] duration-150",
                active ? "brand-gradient-soft" : "bg-transparent",
              )}
            >
              {item.icon}
            </div>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export { BottomNav }
