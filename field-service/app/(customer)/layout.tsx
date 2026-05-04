// Customer PWA layout
// Mobile-first, bottom navigation, minimal chrome

import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { AppLogo } from '@/components/shared/app-logo'
import { AppNavLink } from '@/components/shared/app-nav-link'
import { MobileGate } from '@/components/shared/mobile-gate'
import { siteConfig } from '@/lib/metadata'
import { BusinessTypePrompt } from '@/components/customer/BusinessTypePrompt'

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

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  // DB lookup is best-effort — a backend outage must not crash the public shell.
  // Fall back to session-only display data if the query fails.
  let customer = null
  let showBusinessPrompt = false
  if (session) {
    try {
      customer = await resolveCustomerForSession(db, session)

      // Show the business-type prompt only for brand-new accounts that haven't
      // answered the question yet. Since isBusinessAccount defaults to false we
      // use businessName === null as the "unanswered" signal, combined with a
      // 10-minute createdAt window so returning users never see it again.
      if (customer) {
        const promptFields = await db.customer.findUnique({
          where: { id: customer.id },
          select: { businessName: true, createdAt: true },
        })
        if (
          promptFields &&
          promptFields.businessName === null &&
          Date.now() - promptFields.createdAt.getTime() < 10 * 60 * 1000
        ) {
          showBusinessPrompt = true
        }
      }
    } catch {
      // intentionally swallowed — shell renders with session phone/null label
    }
  }
  const rawPhone = session?.phone ?? customer?.phone ?? null
  const customerLabel =
    customer?.name?.trim() ||
    (rawPhone ? rawPhone.replace(/^\+27/, '0') : null) ||
    'My Account'

  return (
    <MobileGate>
    <div className="app-shell flex min-h-screen flex-col">
      <header className="app-shell-header sticky top-0 z-50 safe-top">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <AppLogo priority compact />
          <span className="max-w-[11rem] truncate rounded-full border border-border/80 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            {customerLabel}
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

      {showBusinessPrompt && <BusinessTypePrompt />}
    </div>
    </MobileGate>
  )
}
