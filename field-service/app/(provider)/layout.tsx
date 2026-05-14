// Provider PWA layout — mobile-first, bottom navigation, design system v2

import { Home, Inbox, Briefcase, CircleUser, Coins } from 'lucide-react'
import { requireProvider } from '@/lib/auth'
import { BottomNav, type BottomNavItem } from '@/components/shared/bottom-nav'

const ICON_SIZE = 20

const navItems: BottomNavItem[] = [
  { id: 'home',    label: 'Home',    icon: <Home size={ICON_SIZE} />,       href: '/provider', exact: true },
  { id: 'leads',   label: 'Leads',   icon: <Inbox size={ICON_SIZE} />,      href: '/provider/leads' },
  { id: 'jobs',    label: 'Jobs',    icon: <Briefcase size={ICON_SIZE} />,  href: '/provider/jobs' },
  { id: 'credits', label: 'Credits', icon: <Coins size={ICON_SIZE} />,      href: '/provider/credits' },
  { id: 'profile', label: 'Profile', icon: <CircleUser size={ICON_SIZE} />, href: '/provider/profile' },
]

export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireProvider()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <main className="flex-1 pb-[calc(80px+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>
      <BottomNav items={navItems} />
    </div>
  )
}
