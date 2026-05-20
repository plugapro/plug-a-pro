// Admin console layout
// Desktop-first, sidebar navigation, full data access
// Auth enforced via proxy.ts - only admin/owner role can access

import { requireAdmin } from '@/lib/auth'
import { AppLogo } from '@/components/shared/app-logo'
import { AppNavLink } from '@/components/shared/app-nav-link'
import { ADMIN_NAV_ITEMS } from '@/lib/admin-nav-routes'
import { headers } from 'next/headers'
import { shouldRestrictAdminDomainToDesktop } from '@/lib/admin-desktop-policy'
import { Button } from '@/components/ui/button'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const requestHeaders = await headers()
  const hostHeader = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const userAgent = requestHeaders.get('user-agent')

  if (shouldRestrictAdminDomainToDesktop(hostHeader, userAgent)) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-6 py-12">
        <div className="w-full rounded-2xl border border-border/60 bg-card/85 p-8 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Admin console
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Desktop required for admin access
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            The admin console is restricted to desktop browsers only for secure management operations.
            Open this page on a desktop device and sign in again.
          </p>
        </div>
      </div>
    )
  }

  // Auth guard - redirects if not admin or owner
  const user = await requireAdmin()

  return (
    <div className="app-shell flex min-h-screen bg-background">
      <aside className="app-shell-panel hidden w-72 shrink-0 border-r border-r-border/70 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:rounded-none md:border-y-0 md:border-l-0">
        <div className="flex h-18 items-center justify-between border-b border-border/70 px-5 py-4">
          <AppLogo compact />
          <span className="rounded-full border border-border/80 bg-card/70 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Admin
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-0.5">
            {ADMIN_NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <AppNavLink
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  variant="sidebar"
                />
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-border/70 p-4 space-y-2">
          <p className="app-kicker">Signed in</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <form
            action={async () => {
              'use server'
              const { cookies } = await import('next/headers')
              ;(await cookies()).set('sb-access-token', '', { maxAge: 0, path: '/' })
            }}
          >
            <button
              type="submit"
              className="w-full rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-shell-header flex h-16 items-center justify-between px-4 md:hidden">
          <AppLogo compact />
          <span className="rounded-full border border-border/80 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            Admin
          </span>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6 xl:px-8">{children}</main>
      </div>
    </div>
  )
}
