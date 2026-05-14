export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  Droplets, Hammer, Zap, Paintbrush, Sparkles, Wrench,
  Flame, Tv2, Bell, ArrowRight, ShieldCheck, Search, Star,
} from 'lucide-react'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/shared/app-logo'
import { SectionLabel } from '@/components/ui/section-label'
import { AreaSelector } from '@/components/customer/AreaSelector'
import { SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'

export const metadata = buildMetadata({
  title: 'Find trusted service providers near you',
  description: 'Search providers, compare profiles, request service, and get WhatsApp updates.',
})

const CATEGORIES = [
  { label: 'Plumbing',     tag: 'plumbing',   icon: Droplets,    hue: '#2A78F0' },
  { label: 'Electrical',   tag: 'electrical',  icon: Zap,         hue: '#FFC22B' },
  { label: 'Handyman',     tag: 'handyman',    icon: Hammer,      hue: '#8B3FE8' },
  { label: 'Carpentry',    tag: 'carpentry',   icon: Wrench,      hue: '#C8854D' },
  { label: 'Painting',     tag: 'painting',    icon: Paintbrush,  hue: '#FF1F8E' },
  { label: 'Cleaning',     tag: 'cleaning',    icon: Sparkles,    hue: '#0FA28A' },
  { label: 'Appliances',   tag: 'appliances',  icon: Tv2,         hue: '#5B5B66' },
  { label: 'Gas & Geyser', tag: 'plumbing',    icon: Flame,       hue: '#E5484D', q: 'geyser' },
] as const

const CATEGORY_LABELS = new Map(SERVICE_CATEGORY_OPTIONS.map(o => [o.tag, o.label]))

function categoryHref(tag: string, area?: string, q?: string) {
  const params = new URLSearchParams()
  params.set('category', tag)
  if (area) params.set('area', area)
  if (q) params.set('q', q)
  return `/providers?${params.toString()}`
}

export default async function CustomerHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ area?: string }>
} = {}) {
  const { area } = await (searchParams ?? Promise.resolve({}))
  const session = await getSession()
  let customer: { id: string; name: string | null } | null = null
  let provider: { id: string; name: string | null } | null = null

  const [sessionData, providerStrip] = await Promise.all([
    (async () => {
      if (!session) return { customer: null, provider: null }
      try {
        const [c, p] = await Promise.all([
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
        return { customer: c ? { id: c.id, name: c.name ?? null } : null, provider: p }
      } catch {
        return { customer: null, provider: null }
      }
    })(),
    db.provider.findMany({
      where: {
        active: true,
        verified: true,
        status: 'ACTIVE',
        availableNow: true,
        ...(area ? { serviceAreas: { has: area } } : {}),
      },
      orderBy: [{ averageRating: 'desc' }, { completedJobsCount: 'desc' }],
      take: 6,
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        averageRating: true,
        completedJobsCount: true,
        skills: true,
        providerCategories: {
          where: { approvalStatus: 'APPROVED' },
          orderBy: { categorySlug: 'asc' },
          take: 1,
          select: { categorySlug: true },
        },
      },
    }),
  ])

  customer = sessionData.customer
  provider = sessionData.provider

  const hasProviderRole = Boolean(provider) || session?.role === 'provider'
  const hasCustomerRole = Boolean(customer) || session?.role === 'customer'
  const isLoggedOut = !session
  const firstName = (customer?.name || provider?.name || '').split(' ')[0]

  const areaLabel = area
    ? area.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null

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
          className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[12px] text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
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
              : `Hi ${firstName || 'there'} — what needs fixing?`}
        </h1>
        <p className="mt-2 mb-4 text-[14.5px] leading-relaxed text-[var(--ink-mute)] [text-wrap:pretty] max-w-[320px]">
          {isLoggedOut
            ? 'Plumbers, electricians, handymen and more — vetted, rated, and tracked end-to-end.'
            : hasProviderRole && !hasCustomerRole
              ? 'Your provider account is signed in. Manage jobs, leads, and availability.'
              : 'Start a new request fast, or browse trusted providers by category.'}
        </p>

        {/* Unified search — area-aware */}
        <form action="/providers" method="get">
          {area && <input type="hidden" name="area" value={area} />}
          <div
            className="flex items-center h-14 rounded-[18px] px-1.5 pl-4 gap-0"
            style={{ background: 'var(--card)', boxShadow: '0 1px 0 var(--border), 0 10px 30px rgba(15,15,30,0.05)' }}
          >
            <Search size={18} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
            <input
              name="q"
              placeholder="Plumber, leak, electrician…"
              className="flex-1 min-w-0 h-full border-none outline-none bg-transparent px-3 text-[15px] font-medium placeholder:text-[var(--ink-soft)]"
              style={{ color: 'var(--ink)' }}
            />
            <button
              type="submit"
              className="flex items-center gap-1 h-11 px-[14px] rounded-[14px] brand-gradient text-white font-bold text-[13px] tracking-[-0.01em] shrink-0"
            >
              <Zap size={14} />
              Search
            </button>
          </div>
        </form>

        {/* Area selector */}
        <div className="mt-3">
          <AreaSelector currentArea={area} />
        </div>
      </div>

      {/* Categories */}
      <div className="px-[18px] pt-2 pb-1.5">
        <SectionLabel
          action={
            <Link
              href={area ? `/providers?area=${encodeURIComponent(area)}` : '/providers'}
              className="text-[13px] font-semibold"
              style={{ color: 'var(--brand-purple)' }}
            >
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
                href={categoryHref(cat.tag, area, 'q' in cat ? cat.q : undefined)}
                className="flex flex-col items-center gap-2 pt-[14px] pb-[10px] px-1.5 rounded-[16px] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-px active:scale-[0.985]"
                style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
              >
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-[11px]"
                  style={{ background: `${cat.hue}15`, color: cat.hue }}
                >
                  <Icon size={20} />
                </div>
                <span className="text-[11.5px] font-semibold text-center leading-tight tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
                  {cat.label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Provider strip — available now */}
      {providerStrip.length > 0 && (
        <div className="pt-5 pb-1">
          <div className="px-[18px] mb-3">
            <SectionLabel
              action={
                <Link
                  href={area ? `/providers?area=${encodeURIComponent(area)}&availability=available_now` : '/providers'}
                  className="text-[13px] font-semibold"
                  style={{ color: 'var(--brand-purple)' }}
                >
                  See all
                </Link>
              }
            >
              {areaLabel ? `Available near ${areaLabel}` : 'Available now'}
            </SectionLabel>
          </div>
          <div className="flex gap-3 overflow-x-auto px-[18px] pb-3 scrollbar-hide">
            {providerStrip.map((p) => {
              const mainCategory = p.providerCategories[0]?.categorySlug ?? p.skills[0] ?? null
              const categoryDisplayLabel = mainCategory
                ? (CATEGORY_LABELS.get(mainCategory) ?? mainCategory.replace(/-/g, ' '))
                : 'General'
              return (
                <Link
                  key={p.id}
                  href={`/providers/${p.id}`}
                  className="shrink-0 w-[155px] rounded-[20px] p-4 flex flex-col gap-1.5 press-feedback"
                  style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
                >
                  {/* Avatar */}
                  <div
                    className="w-11 h-11 rounded-full overflow-hidden mb-1 flex items-center justify-center text-[17px] font-bold"
                    style={{ background: 'linear-gradient(135deg, rgba(139,63,232,0.15), rgba(42,120,240,0.15))', color: 'var(--brand-purple)' }}
                  >
                    {p.avatarUrl
                      ? <img src={p.avatarUrl} alt={p.name} className="w-full h-full object-cover" />
                      : p.name.charAt(0).toUpperCase()
                    }
                  </div>

                  <p className="text-[13px] font-bold leading-tight truncate" style={{ color: 'var(--ink)' }}>{p.name}</p>
                  <p className="text-[11px] capitalize truncate" style={{ color: 'var(--ink-mute)' }}>{categoryDisplayLabel}</p>

                  <div className="flex items-center gap-1 mt-0.5">
                    <Star size={11} className="fill-amber-400 text-amber-400" />
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {Number(p.averageRating).toFixed(1)}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--ink-mute)' }}>
                      · {p.completedJobsCount} jobs
                    </span>
                  </div>

                  <div className="mt-1 inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.1)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" aria-hidden />
                    <span className="text-[10px] font-semibold text-emerald-700">Available</span>
                  </div>
                </Link>
              )
            })}

            {/* See all card */}
            <Link
              href={area ? `/providers?area=${encodeURIComponent(area)}` : '/providers'}
              className="shrink-0 w-[120px] rounded-[20px] p-4 flex flex-col items-center justify-center gap-2 press-feedback"
              style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(139,63,232,0.1)' }}
              >
                <ArrowRight size={18} style={{ color: 'var(--brand-purple)' }} />
              </div>
              <span className="text-[12px] font-semibold text-center leading-tight" style={{ color: 'var(--ink)' }}>
                See all providers
              </span>
            </Link>
          </div>
        </div>
      )}

      {/* Quick CTA section */}
      <div className="px-[18px] pt-5 pb-4">
        <SectionLabel>Get started</SectionLabel>
        <div className="flex flex-col gap-2">
          {isLoggedOut ? (
            <>
              <Button asChild fullWidth size="md">
                <Link href={area ? `/services?area=${encodeURIComponent(area)}` : '/services'}>
                  Request a service
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild fullWidth variant="secondary" size="md">
                <Link href="/sign-in">Sign in to my account</Link>
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
                <Link href="/provider">Provider dashboard</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild fullWidth size="md">
                <Link href={area ? `/services?area=${encodeURIComponent(area)}` : '/services'}>
                  Request a service
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild fullWidth variant="secondary" size="md">
                <Link href="/bookings">My bookings</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="px-[18px] pt-2 pb-4">
        <SectionLabel>How it works</SectionLabel>
        <div className="rounded-[24px] divide-y" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)', divideColor: 'var(--border)' }}>
          {[
            { icon: <Search size={18} />,      title: 'Set your area',         desc: 'Tap "Near you" to filter by your suburb or city.' },
            { icon: <ShieldCheck size={18} />,  title: 'Browse & pick',         desc: 'See vetted providers available right now near you.' },
            { icon: <Bell size={18} />,          title: 'Request & track',       desc: 'Submit a request — updates come straight to WhatsApp.' },
            { icon: <Zap size={18} />,           title: 'Pay after the job',     desc: 'Rate your provider when the work is done.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 px-5 py-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-center w-8 h-8 rounded-[10px] brand-gradient-soft shrink-0" style={{ color: 'var(--brand-purple)' }}>
                {icon}
              </div>
              <div>
                <p className="text-[14px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>{title}</p>
                <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink-mute)' }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Provider CTA */}
      {(isLoggedOut || hasCustomerRole) && (
        <div className="px-[18px] pb-8">
          <div className="rounded-[24px] p-5" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            <h2 className="text-[15px] font-bold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
              Are you a service provider?
            </h2>
            <p className="text-[13px] mt-1 mb-4" style={{ color: 'var(--ink-mute)' }}>
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
