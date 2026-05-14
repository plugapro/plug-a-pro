export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  Droplets, Hammer, Zap, Paintbrush, Sparkles, Wrench,
  Flame, Tv2, Bell, MapPin, ChevronDown, ArrowRight,
  ShieldCheck, Search,
} from 'lucide-react'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/shared/app-logo'
import { SectionLabel } from '@/components/ui/section-label'

export const metadata = buildMetadata({
  title: 'Find trusted service providers near you',
  description: 'Search providers, compare profiles, request service, and get WhatsApp updates.',
})

const CATEGORIES = [
  { label: 'Plumbing',    href: '/providers?category=plumbing',  icon: Droplets, hue: '#2A78F0' },
  { label: 'Electrical',  href: '/providers?category=electrical', icon: Zap,      hue: '#FFC22B' },
  { label: 'Handyman',    href: '/providers?category=handyman',   icon: Hammer,   hue: '#8B3FE8' },
  { label: 'Carpentry',   href: '/providers?category=carpentry',  icon: Wrench,   hue: '#C8854D' },
  { label: 'Painting',    href: '/providers?category=painting',   icon: Paintbrush, hue: '#FF1F8E' },
  { label: 'Cleaning',    href: '/providers?category=cleaning',   icon: Sparkles, hue: '#0FA28A' },
  { label: 'Appliances',  href: '/providers?category=appliances', icon: Tv2,      hue: '#5B5B66' },
  { label: 'Gas & Geyser',href: '/providers?category=plumbing&q=geyser', icon: Flame, hue: '#E5484D' },
] as const

export default async function CustomerHomePage() {
  const session = await getSession()
  let customer: { id: string; name: string | null } | null = null
  let provider: { id: string; name: string | null } | null = null

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
      customer = resolvedCustomer ? { id: resolvedCustomer.id, name: resolvedCustomer.name ?? null } : null
      provider = resolvedProvider
    } catch {
      // keep homepage available on backend outage
    }
  }

  const hasProviderRole = Boolean(provider) || session?.role === 'provider'
  const hasCustomerRole = Boolean(customer) || session?.role === 'customer'
  const isLoggedOut = !session
  const firstName = (customer?.name || provider?.name || '').split(' ')[0]

  return (
    <div className="relative screen-enter">
      {/* gradient halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 right-0 h-72"
        style={{ background: 'radial-gradient(70% 100% at 50% -20%, rgba(139,63,232,0.12), transparent 70%)' }}
      />

      {/* Header strip */}
      <div className="relative flex items-center gap-3 px-[18px] pt-[60px] pb-1.5">
        <AppLogo href="/" compact className="h-8" priority />
        <div className="flex-1" />
        <Link
          href="/profile"
          aria-label="Notifications"
          className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[12px] bg-card shadow-[inset_0_0_0_1px_var(--border)] text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]"
        >
          <Bell size={18} />
          <span className="absolute top-2 right-[9px] w-2 h-2 rounded-full bg-[var(--brand-pink)] shadow-[0_0_0_2px_var(--card)]" aria-hidden />
        </Link>
      </div>

      {/* Hero */}
      <div className="relative px-[18px] pt-2 pb-4">
        <div className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full brand-gradient-soft text-[var(--brand-purple)] text-[11.5px] font-bold tracking-[0.02em] mb-3">
          <ShieldCheck size={13} />
          Reviewed providers · Pay after the job
        </div>
        <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--ink)] [text-wrap:balance]">
          {isLoggedOut
            ? 'Find trusted help, near you.'
            : hasProviderRole && !hasCustomerRole
              ? `Hi ${firstName || 'there'} — manage your jobs`
              : `Hi ${firstName || 'there'} — what needs fixing?`
          }
        </h1>
        <p className="mt-2 mb-4 text-[14.5px] leading-relaxed text-[var(--ink-mute)] [text-wrap:pretty] max-w-[320px]">
          {isLoggedOut
            ? 'Plumbers, electricians, handymen and more — vetted, rated, and tracked end-to-end.'
            : hasProviderRole && !hasCustomerRole
              ? 'Your provider account is signed in. Manage jobs, leads, and availability.'
              : 'Start a new request fast, or browse trusted providers by category.'}
        </p>

        {/* Search bar */}
        <form action="/providers" method="get">
          <div className="flex items-center h-14 bg-card rounded-[18px] shadow-[0_1px_0_var(--border),0_10px_30px_rgba(15,15,30,0.05)] px-1.5 pl-4 gap-0">
            <Search size={18} className="text-[var(--ink-mute)] shrink-0" />
            <input
              name="q"
              placeholder="Plumber, leak, electrician…"
              className="flex-1 min-w-0 h-full border-none outline-none bg-transparent px-3 text-[15px] font-medium text-[var(--ink)] placeholder:text-[var(--ink-soft)]"
            />
            <Link
              href="/services"
              className="flex items-center gap-1 h-11 px-[14px] rounded-[14px] brand-gradient text-white font-bold text-[13px] tracking-[-0.01em] shrink-0"
            >
              <Zap size={14} />
              Request
            </Link>
          </div>
        </form>

        {/* Location chip */}
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-full bg-[var(--card-alt)] text-[var(--ink)] text-[12.5px] font-semibold border-none cursor-pointer"
        >
          <MapPin size={14} className="text-[var(--brand-purple)]" />
          Near you
          <ChevronDown size={13} className="text-[var(--ink-mute)]" />
        </button>
      </div>

      {/* Categories */}
      <div className="px-[18px] pt-2 pb-1.5">
        <SectionLabel
          action={
            <Link href="/providers" className="text-[13px] font-semibold text-[var(--brand-purple)]">
              See all
            </Link>
          }
        >
          Browse by category
        </SectionLabel>
        <div className="grid grid-cols-4 gap-2.5">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            return (
              <Link
                key={cat.label}
                href={cat.href}
                className="flex flex-col items-center gap-2 pt-[14px] pb-[10px] px-1.5 bg-card rounded-[16px] shadow-[inset_0_0_0_1px_var(--border)] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)] active:translate-y-px active:scale-[0.985]"
              >
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-[11px]"
                  style={{ background: `${cat.hue}15`, color: cat.hue }}
                >
                  <Icon size={20} />
                </div>
                <span className="text-[11.5px] font-semibold text-[var(--ink)] text-center leading-tight tracking-[-0.01em]">
                  {cat.label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Quick CTA section */}
      <div className="px-[18px] pt-5 pb-4">
        <SectionLabel>Get started</SectionLabel>
        <div className="flex flex-col gap-2">
          {isLoggedOut ? (
            <>
              <Button asChild fullWidth size="md">
                <Link href="/services">
                  Request a service
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild fullWidth variant="secondary" size="md">
                <Link href="/sign-in">
                  Sign in to my account
                </Link>
              </Button>
            </>
          ) : hasProviderRole && !hasCustomerRole ? (
            <>
              <Button asChild fullWidth size="md">
                <Link href="/provider/jobs">
                  View jobs
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild fullWidth variant="secondary" size="md">
                <Link href="/provider">
                  Provider dashboard
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild fullWidth size="md">
                <Link href="/services">
                  Request a service
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild fullWidth variant="secondary" size="md">
                <Link href="/bookings">
                  My bookings
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="px-[18px] pt-2 pb-4">
        <SectionLabel>How it works</SectionLabel>
        <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] divide-y divide-[var(--border)]">
          {[
            { icon: <Search size={18} />,     title: 'Tell us what you need',  desc: 'Pick a category and describe the job.' },
            { icon: <ShieldCheck size={18} />, title: 'We match providers',    desc: 'Vetted pros in your area get notified.' },
            { icon: <Bell size={18} />,        title: 'Approve & track',       desc: 'Updates straight to WhatsApp.' },
            { icon: <Zap size={18} />,         title: 'Pay after the job',     desc: 'Rate your provider when it\'s done.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 px-5 py-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-[10px] brand-gradient-soft text-[var(--brand-purple)] shrink-0">
                {icon}
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[var(--ink)] tracking-[-0.01em]">{title}</p>
                <p className="text-[13px] text-[var(--ink-mute)] mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Provider CTA */}
      {(isLoggedOut || hasCustomerRole) && (
        <div className="px-[18px] pb-8">
          <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-5">
            <h2 className="text-[15px] font-bold text-[var(--ink)] tracking-[-0.01em]">Are you a service provider?</h2>
            <p className="text-[13px] text-[var(--ink-mute)] mt-1 mb-4">
              Apply to receive job opportunities through WhatsApp.
            </p>
            <Button asChild fullWidth variant="secondary" size="sm">
              <Link href="/provider-sign-in">Join as provider</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
