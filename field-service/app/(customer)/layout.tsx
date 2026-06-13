// Customer PWA layout - mobile-first, bottom navigation, design system v2

export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import {
  Home,
  Search,
  CalendarDays,
  CircleUser,
  Briefcase,
  LayoutDashboard,
} from 'lucide-react'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { siteConfig } from '@/lib/metadata'
import { BottomNav, type BottomNavItem } from '@/components/shared/bottom-nav'
import { BusinessTypePrompt } from '@/components/customer/BusinessTypePrompt'
import { InstallPrompt } from '@/components/shared/InstallPrompt'
import { AuthRefresh } from '@/components/shared/AuthRefresh'

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
}

const ICON_SIZE = 20

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  let customer = null
  let provider: { id: string; name: string | null } | null = null
  let showBusinessPrompt = false

  if (session) {
    try {
      const [resolvedCustomer, resolvedProvider] = await Promise.all([
        resolveCustomerForSession(db, session),
        db.provider.findFirst({
          where: {
            OR: [
              { userId: session.id },
              ...(session.phone ? [{ phone: session.phone }] : []),
            ],
          },
          select: { id: true, name: true },
        }),
      ])
      customer = resolvedCustomer
      provider = resolvedProvider

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
      // shell renders with session data on backend outage
    }
  }

  const hasProviderRole = Boolean(provider) || session?.role === 'provider'
  const hasCustomerRole = Boolean(customer) || session?.role === 'customer'
  const isLoggedOut = !session
  const isMultiRole = Boolean(session && hasProviderRole && hasCustomerRole)

  const navItems: BottomNavItem[] = isLoggedOut
    ? [
        { id: 'home',    label: 'Home',    icon: <Home size={ICON_SIZE} />,     href: '/' },
        { id: 'browse',  label: 'Browse',  icon: <Search size={ICON_SIZE} />,   href: '/providers' },
        { id: 'account', label: 'Sign in', icon: <CircleUser size={ICON_SIZE} />, href: '/sign-in' },
      ]
    : isMultiRole
      ? [
          { id: 'home',     label: 'Home',     icon: <Home size={ICON_SIZE} />,           href: '/' },
          { id: 'request',  label: 'Request',  icon: <Search size={ICON_SIZE} />,         href: '/services' },
          { id: 'provider', label: 'Provider', icon: <Briefcase size={ICON_SIZE} />,      href: '/provider' },
          { id: 'account',  label: 'Profile',  icon: <CircleUser size={ICON_SIZE} />,     href: '/profile' },
        ]
      : hasProviderRole
        ? [
            { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={ICON_SIZE} />, href: '/provider' },
            { id: 'jobs',      label: 'Jobs',      icon: <Briefcase size={ICON_SIZE} />,       href: '/provider/jobs' },
            { id: 'account',   label: 'Profile',   icon: <CircleUser size={ICON_SIZE} />,      href: '/provider/profile' },
          ]
        : [
            { id: 'home',     label: 'Home',     icon: <Home size={ICON_SIZE} />,         href: '/' },
            { id: 'bookings', label: 'Bookings', icon: <CalendarDays size={ICON_SIZE} />, href: '/bookings' },
            { id: 'account',  label: 'Profile',  icon: <CircleUser size={ICON_SIZE} />,   href: '/profile' },
          ]

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <main className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>

      <BottomNav
        items={navItems}
        authAwareAccount={{
          accountItemId: 'account',
          protectedPathPrefixes: ['/bookings', '/profile', '/messages', '/account'],
          signedOut: { label: 'Sign in', href: '/sign-in' },
          signedInCustomer: { label: 'Profile', href: '/profile' },
          signedInProvider: {
            label: 'Profile',
            href: hasProviderRole && !hasCustomerRole ? '/provider/profile' : '/profile',
          },
          loading: { label: 'Account', href: '/profile' },
          initialAuthState: {
            authenticated: Boolean(session),
            role: session?.role ?? null,
          },
        }}
      />
      <InstallPrompt />
      <AuthRefresh />
      {showBusinessPrompt && <BusinessTypePrompt />}
    </div>
  )
}
