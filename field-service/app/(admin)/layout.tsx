// Admin console layout
// Desktop-first, sidebar navigation, full data access
// Auth enforced via proxy.ts — only admin/owner role can access

import { requireAdmin } from '@/lib/auth'
import { siteConfig } from '@/lib/metadata'

const NAV_ITEMS = [
  { href: '/admin',              label: 'Dashboard' },
  { href: '/admin/bookings',     label: 'Bookings' },
  { href: '/admin/dispatch',     label: 'Dispatch' },
  { href: '/admin/applications', label: 'Applications' },
  { href: '/admin/technicians',  label: 'Technicians' },
  { href: '/admin/customers',    label: 'Customers' },
  { href: '/admin/services',     label: 'Services' },
  { href: '/admin/payments',     label: 'Payments' },
  { href: '/admin/reports',      label: 'Reports' },
  { href: '/admin/messages',     label: 'Messages' },
  { href: '/admin/settings',     label: 'Settings' },
] as const

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Auth guard — redirects if not admin or owner
  const user = await requireAdmin()

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 border-r md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-4">
          <span className="font-semibold text-sm">{siteConfig.name}</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t p-3">
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 items-center border-b px-4 md:hidden">
          <span className="font-semibold text-sm">{siteConfig.name} Admin</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
