export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  Droplets, Hammer, Paintbrush, Sparkles, Wrench,
  Tv2, Grid3x3, Layers, PaintRoller, Leaf, Drill,
  Bell, ShieldCheck, Search,
  Check, Star, MapPin,
} from 'lucide-react'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { AppLogo } from '@/components/shared/app-logo'
import { Wordmark } from '@/components/shared/wordmark'
import { SectionLabel } from '@/components/ui/section-label'
import { AreaSelector } from '@/components/customer/AreaSelector'
import { CustomerRequestSearchForm } from '@/components/customer/CustomerRequestSearchForm'

export const metadata = buildMetadata({
  title: 'Skilled help near you - book local service providers',
  description: 'Browse rated local providers, get a written quote and book on WhatsApp.',
})

// Tiles must stay in sync with PILOT_SKILL_TAGS in lib/service-categories.ts.
const CATEGORIES = [
  { label: 'Plumbing',           tag: 'plumbing',     icon: Droplets,    hue: '#2A78F0' },
  { label: 'Appliances',         tag: 'appliances',   icon: Tv2,         hue: '#5B5B66' },
  { label: 'Handyman',           tag: 'handyman',     icon: Hammer,      hue: '#8B3FE8' },
  { label: 'Carpentry',          tag: 'carpentry',    icon: Wrench,      hue: '#C8854D' },
  { label: 'Painting',           tag: 'painting',     icon: Paintbrush,  hue: '#FF1F8E' },
  { label: 'Cleaning',           tag: 'cleaning',     icon: Sparkles,    hue: '#0FA28A' },
  { label: 'Garden',             tag: 'garden',       icon: Leaf,        hue: '#3FA86C' },
  { label: 'DIY & Assembly',     tag: 'diy',          icon: Drill,       hue: '#E58F23' },
  { label: 'Tiling',             tag: 'tiling',       icon: Grid3x3,     hue: '#4FB6E6' },
  { label: 'Plastering',         tag: 'plastering',   icon: Layers,      hue: '#B0A99F' },
  { label: 'Rhinoliting',        tag: 'rhinoliting',  icon: PaintRoller, hue: '#D9C29A' },
] as const


function categoryHref(tag: string, area?: string, q?: string) {
  const params = new URLSearchParams()
  params.set('category', tag)
  if (area) params.set('area', area)
  if (q) params.set('q', q)
  return `/providers?${params.toString()}`
}

// Inline provider card for "Top rated near you" section

export default async function CustomerHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ area?: string }>
} = {}) {
  const { area } = await (searchParams ?? Promise.resolve({} as { area?: string }))
  const session = await getSession()
  let customer: { id: string; name: string | null } | null = null
  let provider: { id: string; name: string | null } | null = null

  const sessionData = await (async () => {
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
  })()

  customer = sessionData.customer
  provider = sessionData.provider

  const [completedJobsCount, verifiedProviderCount] = await Promise.all([
    db.job.count({ where: { status: 'COMPLETED' } }),
    db.provider.count({ where: { verified: true, active: true, status: 'ACTIVE' } }),
  ]).catch(() => [0, 0] as const)

  const isLoggedOut = !session
  const hasProviderRole = Boolean(provider) || session?.role === 'provider' || Boolean(session?.isProvider)
  const hasCustomerRole = Boolean(customer) || session?.role === 'customer'
  // Prefer the provider name for providers so a leftover placeholder "Customer"
  // record never surfaces in the greeting ("Hi Customer").
  const preferredName = hasProviderRole
    ? (provider?.name || customer?.name)
    : (customer?.name || provider?.name)
  const firstName = (preferredName || '').split(' ')[0]

  return (
    <div className="relative screen-enter">
      {/* Gradient halo */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 right-0 h-72"
        style={{ background: 'radial-gradient(70% 100% at 50% -20%, rgba(139,63,232,0.15), transparent 70%)' }}
      />

      {/* ── Header strip ─────────────────────────────────────────────── */}
      <div className="relative flex items-center gap-2.5 px-[18px] pt-[60px] pb-1.5">
        <AppLogo href="/" compact className="h-8" priority />
        <Wordmark size={13} />
        <div className="flex-1" />
        <Link
          href="/profile"
          aria-label="Account"
          className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[12px] text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <Bell size={18} />
          <span className="absolute top-2 right-[9px] w-2 h-2 rounded-full bg-[var(--brand-pink)] shadow-[0_0_0_2px_var(--card)]" aria-hidden />
        </Link>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="relative px-[18px] pt-2 pb-4">
        {/* Trust pill */}
        <div
          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full brand-gradient-soft text-[var(--brand-purple)] text-[11.5px] font-bold tracking-[0.02em] mb-3"
        >
          <ShieldCheck size={13} />
          Rated by real customers · Pay on completion
        </div>

        <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--ink)] [text-wrap:balance]">
          {isLoggedOut
            ? 'Skilled help near you.'
            : hasProviderRole && !hasCustomerRole
              ? `Hi ${firstName || 'there'} -`
              : `Hi ${firstName || 'there'} -`}
          {!isLoggedOut && <><br />what needs fixing?</>}
        </h1>
        <p className="mt-2 mb-4 text-[14.5px] leading-relaxed text-[var(--ink-mute)] [text-wrap:pretty] max-w-[320px]">
          Plumbers, handymen, gardeners, tilers and more - rated by customers who booked them.
        </p>

        {/* Search bar */}
        <CustomerRequestSearchForm currentArea={area ?? null} />

        {/* Location chip */}
        <div className="mt-3">
          <AreaSelector currentArea={area} />
        </div>

        {/* WhatsApp trust signal */}
        <p className="mt-3 text-[12px] leading-relaxed text-center" style={{ color: 'var(--ink-soft)' }}>
          Updates sent to your WhatsApp · Quote in writing before work starts
        </p>
      </div>

      {/* ── Categories ───────────────────────────────────────────────── */}
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
                href={categoryHref(cat.tag, area)}
                className="flex flex-col items-center gap-2 pt-[14px] pb-[10px] px-1.5 rounded-[16px] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-px active:scale-[0.985]"
                style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
              >
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-[11px]"
                  style={{ background: `${cat.hue}15`, color: cat.hue }}
                  aria-hidden
                >
                  <Icon size={20} aria-hidden />
                </div>
                <span className="text-[11.5px] font-semibold text-center leading-tight tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
                  {cat.label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <div className="px-[18px] pt-5 pb-1">
        <SectionLabel>How it works</SectionLabel>
        <div
          className="divide-y divide-[var(--border)]"
          style={{ background: 'var(--card)', borderRadius: 24, boxShadow: 'inset 0 0 0 1px var(--border)', padding: '4px 0' }}
        >
          {[
            { icon: <Sparkles size={18} />, n: 1, title: 'Tell us what you need', desc: 'Pick a category and describe the job.' },
            { icon: <Search size={18} />,   n: 2, title: 'We match providers',   desc: 'Skilled pros in your area get notified.' },
            { icon: <Bell size={18} />,      n: 3, title: 'Approve & track',     desc: 'Updates straight to WhatsApp.' },
            { icon: <Check size={18} />,     n: 4, title: 'Pay on completion',   desc: 'Pay your provider and rate the job.' },
          ].map(({ icon, n, title, desc }) => (
            <div key={n} className="flex items-start gap-3 px-4 py-[13px]">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0 brand-gradient-soft"
                style={{ color: 'var(--brand-purple)' }}
              >
                {icon}
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-bold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
                  {n}. {title}
                </p>
                <p className="text-[12.5px] mt-0.5 leading-[1.4]" style={{ color: 'var(--ink-mute)' }}>
                  {desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Trust indicators ─────────────────────────────────────────── */}
      <div className="px-[18px] pt-5 pb-1">
        <div className="grid grid-cols-3 gap-2.5">
          {[
            {
              icon: <ShieldCheck size={18} />,
              value: verifiedProviderCount > 0 ? `${verifiedProviderCount}+` : 'Active',
              label: 'Active providers',
            },
            {
              icon: <Star size={18} />,
              value: 'Written',
              label: 'Quote before work',
            },
            {
              icon: <MapPin size={18} />,
              value: completedJobsCount > 0 ? `${completedJobsCount}+` : 'Local',
              label: completedJobsCount > 0 ? 'Jobs completed' : 'Coverage',
            },
          ].map(({ icon, value, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-1.5 rounded-[16px] py-4 px-2"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              <div style={{ color: 'var(--brand-purple)' }}>{icon}</div>
              <p className="text-[15px] font-bold tracking-[-0.02em]" style={{ color: 'var(--ink)' }}>{value}</p>
              <p className="text-[10.5px] font-medium text-center leading-tight" style={{ color: 'var(--ink-mute)' }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── For service providers CTA ─────────────────────────────────── */}
      {(isLoggedOut || hasCustomerRole) && (
        <div className="px-[18px] pt-5 pb-1">
          <div
            className="relative overflow-hidden rounded-[24px] p-5"
            style={{ background: 'var(--ink)', color: 'var(--card)' }}
          >
            {/* Gradient halo blob */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-10 -right-10 w-48 h-48 rounded-full"
              style={{
                background: 'var(--brand-gradient)',
                opacity: 0.35,
                filter: 'blur(40px)',
              }}
            />
            <div className="relative">
              <div
                className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[10.5px] font-bold tracking-[0.06em] uppercase mb-2.5"
                style={{ background: 'rgba(255,255,255,0.10)' }}
              >
                <Wrench size={11} />
                For service providers
              </div>
              <h2 className="text-[18px] font-bold tracking-[-0.025em] leading-[1.25] mb-1.5">
                Win paying work - without the noise.
              </h2>
              <p className="text-[13px] leading-[1.5] mb-4" style={{ opacity: 0.75 }}>
                Real leads, transparent fees and live job tracking. Apply once, get matched daily.
              </p>
              <div className="flex gap-2">
                <Link
                  href="/provider/register"
                  className="flex-1 h-[42px] rounded-[12px] flex items-center justify-center text-[13.5px] font-bold press-feedback"
                  style={{ background: '#fff', color: '#0A0A0F' }}
                >
                  Join as provider
                </Link>
                <a
                  href="https://wa.me/27693552447?text=Register"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-[42px] px-[14px] rounded-[12px] flex items-center gap-1.5 text-[13.5px] font-bold press-feedback"
                  style={{ background: '#25D366', color: '#fff', boxShadow: '0 6px 18px rgba(37,211,102,0.35)' }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden>
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                  Apply
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div
        className="px-[18px] pt-6 pb-8 text-center text-[11.5px] leading-[1.6]"
        style={{ color: 'var(--ink-soft)' }}
      >
        Your exact address is only shared once a provider accepts.
        <br />
        © 2026 Plug A Pro ·{' '}
        <Link href="/credit-terms" style={{ color: 'var(--ink-mute)', textDecoration: 'underline' }}>Credit terms</Link>
        {' '}·{' '}
        <Link href="/status" style={{ color: 'var(--ink-mute)', textDecoration: 'underline' }}>System status</Link>
      </div>
    </div>
  )
}
