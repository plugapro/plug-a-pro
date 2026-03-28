// Customer PWA layout
// Mobile-first, bottom navigation, minimal chrome

import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Home, CalendarDays, User } from 'lucide-react'
import { siteConfig } from '@/lib/metadata'

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s — ${siteConfig.name}`,
  },
}

const NAV = [
  { href: '/',         label: 'Home',     icon: Home         },
  { href: '/bookings', label: 'Bookings', icon: CalendarDays },
  { href: '/profile',  label: 'Profile',  icon: User         },
]

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Minimal header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex h-14 items-center px-4">
          <Link href="/">
            <Image
              src="/logo.png"
              alt={siteConfig.name}
              width={140}
              height={28}
              priority
              className="h-7 w-auto"
            />
          </Link>
        </div>
      </header>

      {/* Page content — extra bottom padding clears the nav bar */}
      <main className="flex-1 pb-20">{children}</main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-sm safe-bottom">
        <div className="flex h-16 items-center justify-around max-w-lg mx-auto">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
