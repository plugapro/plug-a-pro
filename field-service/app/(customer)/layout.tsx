// Customer PWA layout
// Mobile-first, bottom navigation, minimal chrome

import type { Metadata } from 'next'
import { AppLogo } from '@/components/shared/app-logo'
import { AppNavLink } from '@/components/shared/app-nav-link'
import { siteConfig } from '@/lib/metadata'

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s — ${siteConfig.name}`,
  },
}

const NAV = [
  { href: '/',         label: 'Home',     icon: 'home' as const },
  { href: '/bookings', label: 'Bookings', icon: 'bookings' as const },
  { href: '/profile',  label: 'Profile',  icon: 'profile' as const },
]

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="app-shell-header sticky top-0 z-50 safe-top">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <AppLogo priority compact />
          <span className="rounded-full border border-border/80 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            Customer App
          </span>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="app-bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-bottom">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-3">
          {NAV.map((item) => {
            return (
              <AppNavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
              />
            )
          })}
        </div>
      </nav>
    </div>
  )
}
