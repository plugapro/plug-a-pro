// ─── Customer: Account / Profile ──────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarDays,
  CreditCard,
  Star,
  Bell,
  MapPin,
  ShieldCheck,
  CircleHelp,
  Zap,
  ChevronRight,
  Settings,
  LogOut,
} from 'lucide-react'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveProviderRedirect } from '@/lib/provider-routing'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { SignOutButton } from '@/components/customer/SignOutButton'
import { buildMetadata } from '@/lib/metadata'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { Button } from '@/components/ui/button'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionLabel } from '@/components/ui/section-label'
import { WhatsappPreferencesCard } from './WhatsappPreferencesCard'

export const metadata = buildMetadata({ title: 'Account', noIndex: true })

async function updateProfile(formData: FormData) {
  'use server'
  const { getSession: getServerSession } = await import('@/lib/auth')
  const session = await getServerSession()
  if (!session) return

  const name = (formData.get('name') as string | null)?.trim()
  const email = (formData.get('email') as string | null)?.trim()

  const { db: dbServer } = await import('@/lib/db')
  const { resolveCustomerForSession: resolveCustomer } = await import('@/lib/customer-session')
  const customer = await resolveCustomer(dbServer, session)
  if (!customer) return

  await dbServer.customer.update({
    where: { id: customer.id },
    data: {
      ...(name ? { name } : {}),
      ...(email !== null && email !== undefined ? { email: email || null } : {}),
    },
  })

  redirect('/profile')
}

type NavRowProps = {
  href: string
  icon: React.ReactNode
  hue: string
  title: string
  subtitle?: string
  danger?: boolean
}

function NavRow({ href, icon, hue, title, subtitle, danger = false }: NavRowProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--card-alt)]"
    >
      <div
        className="flex items-center justify-center w-9 h-9 rounded-[11px] shrink-0"
        style={{ background: `${hue}15`, color: hue }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[14px] font-semibold tracking-[-0.01em] ${danger ? 'text-[var(--danger)]' : 'text-[var(--ink)]'}`}>
          {title}
        </p>
        {subtitle && (
          <p className="text-[12.5px] text-[var(--ink-mute)] mt-0.5">{subtitle}</p>
        )}
      </div>
      {!danger && <ChevronRight size={16} className="text-[var(--ink-soft)] shrink-0" />}
    </Link>
  )
}

export default async function ProfilePage() {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/profile')}`)

  // Role-aware: a provider's account lives on the provider area, never the customer
  // account page (which labels everyone "Customer"). Covers portal-eligible providers
  // AND providers still in verification (role==='customer' but isProvider) — the
  // latter previously fell through and were shown as "Customer". Runs on every server
  // render, so it also covers manual URL edits, deep links, and refreshes.
  const providerDest = resolveProviderRedirect(session, 'profile')
  if (providerDest) {
    console.log('[profile] provider routed away from customer profile', {
      userId: session.id,
      phone: session.phone,
      role: session.role,
      isProvider: session.isProvider,
      dest: providerDest,
    })
    redirect(providerDest)
  }

  const customer = await resolveCustomerForSession(db, session)
  const requestCount = customer
    ? await db.jobRequest.count({ where: { customerId: customer.id } })
    : 0

  const displayName = customer?.name ?? session.phone ?? 'You'
  const initials = displayName.split(' ').map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const phone = session.phone ?? customer?.phone ?? null

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5">
        {/* Profile card */}
        <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-5">
          <div className="flex items-center gap-4">
            <div className="w-[60px] h-[60px] rounded-full brand-gradient flex items-center justify-center text-white font-bold text-[22px] tracking-[-0.01em] shrink-0">
              {initials || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-bold text-[var(--ink)] tracking-[-0.02em] truncate">
                {displayName}
              </p>
              {phone && (
                <p className="text-[13.5px] text-[var(--ink-mute)] mt-0.5">{phone}</p>
              )}
              <div className="mt-2 inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-[var(--card-alt)] text-[var(--ink)] text-[12px] font-semibold">
                Customer · {requestCount} {requestCount === 1 ? 'request' : 'requests'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="px-[18px] mb-5">
        <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--ink-mute)] mb-4">Edit profile</p>
          <form action={updateProfile} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
                Name
              </label>
              <Input
                id="name"
                name="name"
                defaultValue={customer?.name ?? ''}
                placeholder="Your name"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-[var(--ink)] mb-1.5 tracking-[-0.01em]">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={customer?.email ?? ''}
                placeholder="you@email.co.za"
              />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--ink)] mb-1 tracking-[-0.01em]">Phone</p>
              <p className="text-[14.5px] text-[var(--ink-mute)]">{phone ?? '-'}</p>
            </div>
            <FormSubmitButton fullWidth size="md" pendingLabel="Saving…">Save changes</FormSubmitButton>
          </form>
        </div>
      </div>

      {/* WhatsApp preferences */}
      <div className="px-[18px] mb-5">
        <WhatsappPreferencesCard />
      </div>

      {/* Activity section */}
      <div className="px-[18px] mb-3">
        <SectionLabel>Activity</SectionLabel>
      </div>
      <div className="mx-[18px] bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] overflow-hidden divide-y divide-[var(--border)]">
        <NavRow href="/bookings" icon={<CalendarDays size={18} />} hue="#8B3FE8" title="My bookings" subtitle="Active and recent requests" />
        <NavRow href="/profile/payments" icon={<CreditCard size={18} />} hue="#2A78F0" title="Payments" subtitle="Invoices and receipts" />
        <NavRow href="/profile/reviews" icon={<Star size={18} />} hue="#FFC22B" title="Reviews you've left" subtitle="Your feedback on providers" />
      </div>

      {/* Settings section */}
      <div className="px-[18px] mt-5 mb-3">
        <SectionLabel>Settings</SectionLabel>
      </div>
      <div className="mx-[18px] bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] overflow-hidden divide-y divide-[var(--border)]">
        <NavRow href="/profile/notifications" icon={<Bell size={18} />} hue="#8B3FE8" title="Notifications" subtitle="Manage alerts and preferences" />
        <NavRow href="/account/sites" icon={<MapPin size={18} />} hue="#0FA28A" title="Saved addresses" subtitle="Homes, offices, sites" />
        <NavRow href="/profile/privacy" icon={<ShieldCheck size={18} />} hue="#5B5B66" title="Privacy & security" />
      </div>

      {/* Appearance section */}
      <div className="px-[18px] mt-5 mb-3">
        <SectionLabel>Appearance</SectionLabel>
      </div>
      <div className="mx-[18px] bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-4">
        <ThemeToggle className="w-full" />
      </div>

      {/* Help section */}
      <div className="px-[18px] mt-5 mb-3">
        <SectionLabel>Help</SectionLabel>
      </div>
      <div className="mx-[18px] bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] overflow-hidden divide-y divide-[var(--border)]">
        <NavRow href="/status" icon={<Zap size={18} />} hue="#FFC22B" title="System status" subtitle="Service health and uptime" />
        <NavRow href="/credit-terms" icon={<CircleHelp size={18} />} hue="#0FA28A" title="Credit & billing terms" />
        <div className="px-5 py-3.5">
          <SignOutButton />
        </div>
      </div>
    </div>
  )
}
