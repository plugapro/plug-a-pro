'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Home,
  LayoutDashboard,
  MessageSquareText,
  Route,
  Settings,
  ShieldAlert,
  SquareStack,
  User,
  UserRound,
  UserRoundCheck,
  Users,
  WalletCards,
  Workflow,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = {
  home: Home,
  bookings: CalendarDays,
  profile: User,
  jobs: BriefcaseBusiness,
  earnings: WalletCards,
  userRound: UserRound,
  operations: LayoutDashboard,
  dispatch: Route,
  workflow: Workflow,
  users: Users,
  categories: SquareStack,
  disputes: ShieldAlert,
  payments: BadgeDollarSign,
  reports: BarChart3,
  messages: MessageSquareText,
  settings: Settings,
  applications: UserRoundCheck,
} as const

export function AppNavLink({
  href,
  label,
  icon,
  variant = 'mobile',
}: {
  href: string
  label: string
  icon?: keyof typeof ICONS
  variant?: 'mobile' | 'sidebar'
}) {
  const pathname = usePathname()
  const active =
    href === '/'
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`)
  const Icon = icon ? ICONS[icon] : null

  if (variant === 'sidebar') {
    return (
      <Link
        href={href}
        className={cn(
          'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
          active
            ? 'tone-brand shadow-[0_8px_20px_rgba(230,70,145,0.12)]'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        {Icon ? <Icon className="h-4 w-4" /> : null}
        <span>{label}</span>
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[0.72rem] font-medium transition-colors',
        active
          ? 'text-primary'
          : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground'
      )}
      aria-current={active ? 'page' : undefined}
    >
      {Icon ? (
        <Icon
          className={cn(
            'h-5 w-5',
            active ? 'text-primary' : 'text-muted-foreground'
          )}
        />
      ) : null}
      <span>{label}</span>
    </Link>
  )
}
