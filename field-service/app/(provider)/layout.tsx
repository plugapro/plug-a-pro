// Provider PWA layout
// Mobile-first, persistent session, offline-tolerant
// Auth enforced via proxy.ts — only provider role can access

import { requireProvider } from '@/lib/auth'
import { AppLogo } from '@/components/shared/app-logo'
import { AppNavLink } from '@/components/shared/app-nav-link'

export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Auth guard — redirects to sign-in if not provider
  await requireProvider()

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="app-shell-header sticky top-0 z-50 safe-top">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <AppLogo compact />
          <span className="rounded-full border border-border/80 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            Provider App
          </span>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="app-bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-bottom">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-3">
          <AppNavLink href="/provider/jobs" label="Jobs" icon="jobs" />
          <AppNavLink href="/provider/leads" label="Leads" icon="leads" />
          <AppNavLink href="/provider/credits" label="Credits" icon="earnings" />
          <AppNavLink href="/provider/profile" label="Profile" icon="userRound" />
        </div>
      </nav>
    </div>
  )
}
