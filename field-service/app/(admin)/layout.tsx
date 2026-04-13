// Admin console layout
// Desktop-first, sidebar navigation, full data access
// Auth enforced via proxy.ts — only admin/owner role can access

import { requireAdmin } from '@/lib/auth'
import { AppLogo } from '@/components/shared/app-logo'
import { AppNavLink } from '@/components/shared/app-nav-link'

const NAV_ITEMS = [
  { href: '/admin',              label: 'Operations',  icon: 'operations' as const },
  { href: '/admin/validation',   label: 'Validation',  icon: 'workflow' as const },
  { href: '/admin/dispatch',     label: 'Dispatch',    icon: 'dispatch' as const },
  { href: '/admin/quotes',       label: 'Quotes',      icon: 'reports' as const },
  { href: '/admin/bookings',     label: 'Bookings',    icon: 'jobs' as const },
  { href: '/admin/matches',      label: 'Matches',     icon: 'workflow' as const },
  { href: '/admin/applications', label: 'Applications', icon: 'applications' as const },
  { href: '/admin/providers',    label: 'Providers',   icon: 'users' as const },
  { href: '/admin/customers',    label: 'Customers',   icon: 'users' as const },
  { href: '/admin/categories',   label: 'Categories',  icon: 'categories' as const },
  { href: '/admin/disputes',     label: 'Disputes',    icon: 'disputes' as const },
  { href: '/admin/payments',     label: 'Payments',    icon: 'payments' as const },
  { href: '/admin/reports',      label: 'Reports',     icon: 'reports' as const },
  { href: '/admin/messages',     label: 'Messages',    icon: 'messages' as const },
  { href: '/admin/settings',     label: 'Settings',    icon: 'settings' as const },
  { href: '/admin/flows',        label: 'Journey Flows', icon: 'workflow' as const },
] as const

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Auth guard — redirects if not admin or owner
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
            {NAV_ITEMS.map((item) => (
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
        <div className="border-t border-border/70 p-4">
          <p className="app-kicker">Signed in</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
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
