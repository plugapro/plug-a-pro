// ─── Provider: Home dashboard ─────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import {
  Briefcase,
  CheckCircle2,
  Clock3,
  Coins,
  Inbox,
  ListChecks,
  MapPin,
  Sparkles,
  Star,
  Tag,
  ToggleLeft,
  ToggleRight,
  Wallet,
  ArrowRight,
  Zap,
  Calendar,
} from 'lucide-react'
import { ProviderSignOutButton } from '@/components/provider/ProviderSignOutButton'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { JobCard } from '@/components/shared/JobCard'
import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import { StatCard } from '@/components/shared/StatCard'
import { CompletionMeter } from '@/components/shared/CompletionMeter'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { EmptyState } from '@/components/shared/EmptyState'
import { AppLogo } from '@/components/shared/app-logo'
import { getProviderWalletBalance } from '@/lib/provider-wallet'
import { getProviderTermsUrl } from '@/lib/provider-credit-copy'
import { calculateProviderProfileCompleteness } from '@/lib/provider-pwa-dashboard'
import { recordAuditLog } from '@/lib/audit'
import { AUDIT_ENTITY } from '@/lib/audit-entities'

export const metadata = buildMetadata({ title: 'Provider Home', noIndex: true })

async function toggleAvailability() {
  'use server'
  const session = await requireProvider()
  const provider = await db.provider.findUnique({ where: { userId: session.id }, select: { id: true, availableNow: true } })
  if (!provider) return
  await db.provider.update({
    where: { id: provider.id },
    data: { availableNow: !provider.availableNow },
  })
  await recordAuditLog({
    actorId: provider.id,
    actorRole: 'provider',
    action: 'provider.availability.toggled',
    entityType: AUDIT_ENTITY.PROVIDER,
    entityId: provider.id,
    before: { availableNow: provider.availableNow },
    after: { availableNow: !provider.availableNow },
  }).catch(() => {})
  revalidatePath('/provider')
}

function UrgencyChip({ urgency }: { urgency: string | null }) {
  if (!urgency) return null
  const map: Record<string, { label: string; cssVar: string }> = {
    asap:      { label: 'Emergency', cssVar: 'var(--danger)' },
    this_week: { label: 'This week',  cssVar: 'var(--color-amber)' },
    flexible:  { label: 'Flexible',   cssVar: 'var(--color-teal)' },
  }
  const config = map[urgency]
  if (!config) return null
  return (
    <span
      className="inline-flex items-center gap-1 h-[20px] px-2 rounded-full text-[11px] font-semibold"
      style={{ background: `color-mix(in srgb, ${config.cssVar} 10%, transparent)`, color: config.cssVar }}
    >
      {urgency === 'asap' && <Zap size={10} aria-hidden />}
      {urgency === 'flexible' && <Calendar size={10} aria-hidden />}
      {config.label}
    </span>
  )
}

export default async function ProviderHomePage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    include: {
      technicianServiceAreas: {
        where: { active: true },
        select: { id: true },
      },
      providerRates: {
        select: { id: true },
      },
    },
  })

  if (!provider) {
    return (
      <div className="px-[18px] pt-[60px] pb-10">
        <EmptyState
          icon={<Briefcase className="size-5" />}
          title="Your provider account isn't set up yet"
          description="Reach out to support to finish onboarding so you can start receiving jobs."
        />
      </div>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const jobInclude = {
    booking: {
      include: {
        match: {
          include: {
            jobRequest: {
              include: {
                customer: true,
                address: true,
              },
            },
          },
        },
      },
    },
  } as const

  const [
    activeJobs,
    upcomingJobs,
    recentCompletedJobs,
    completedJobsCount,
    pendingOpportunitiesCount,
    selectedPendingCount,
    walletBalance,
    pendingLeads,
  ] = await Promise.all([
    db.job.findMany({
      where: {
        providerId: provider.id,
        status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL'] },
      },
      include: jobInclude,
      orderBy: { booking: { scheduledDate: 'asc' } },
    }),
    db.job.findMany({
      where: {
        providerId: provider.id,
        status: 'SCHEDULED',
        booking: { scheduledDate: { gte: tomorrow, lt: nextWeek } },
      },
      include: jobInclude,
      orderBy: { booking: { scheduledDate: 'asc' } },
      take: 10,
    }),
    db.job.findMany({
      where: {
        providerId: provider.id,
        status: { in: ['PENDING_COMPLETION_CONFIRMATION', 'COMPLETED'] },
      },
      include: jobInclude,
      orderBy: { completedAt: 'desc' },
      take: 5,
    }),
    db.job.count({ where: { providerId: provider.id, status: 'COMPLETED' } }),
    db.lead.count({
      where: {
        providerId: provider.id,
        status: { in: ['SENT', 'VIEWED'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
    db.lead.count({
      where: {
        providerId: provider.id,
        customerSelectedAt: { not: null },
        status: { in: ['SENT', 'VIEWED'] },
        jobRequest: { status: 'PROVIDER_CONFIRMATION_PENDING' },
      },
    }),
    getProviderWalletBalance(provider.id),
    db.lead.findMany({
      where: {
        providerId: provider.id,
        status: { in: ['SENT', 'VIEWED'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        status: true,
        jobRequest: {
          select: {
            category: true,
            urgency: true,
            address: { select: { suburb: true } },
          },
        },
      },
      orderBy: { sentAt: 'desc' },
      take: 3,
    }),
  ])

  const termsUrl = getProviderTermsUrl()
  const profileCompleteness = calculateProviderProfileCompleteness({
    name: provider.name,
    phone: provider.phone,
    email: provider.email,
    bio: provider.bio,
    experience: provider.experience,
    skills: provider.skills,
    serviceAreas: provider.serviceAreas,
    structuredServiceAreaCount: provider.technicianServiceAreas.length,
    providerRateCount: provider.providerRates.length,
    portfolioUrlCount: provider.portfolioUrls.length,
  })

  const lowOnCredits = walletBalance.totalCreditBalance <= 1
  const profileIncomplete = profileCompleteness.percentage < 80
  const firstName = provider.name?.split(' ')[0] ?? 'there'
  const rating = provider.averageRating !== null ? Number(provider.averageRating).toFixed(1) : '-'

  return (
    <div className="pb-6 screen-enter">

      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5">
        <div className="flex items-center mb-4">
          <AppLogo href="/provider" compact className="h-[26px]" priority />
          <div className="flex-1" />
          <ProviderSignOutButton />
        </div>
        <p className="text-[11px] font-bold tracking-[0.085em] uppercase text-[var(--brand-purple)] mb-1">
          Provider portal
        </p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
          Hi {firstName} 👋
        </h1>
        <p className="mt-1 text-[14px] text-[var(--ink-mute)]">
          Your jobs, leads, and credits at a glance.
        </p>
      </div>

      <div className="px-[18px] space-y-5">

        {/* Alert banners */}
        {selectedPendingCount > 0 && (
          <AlertCallout
            tone="brand"
            title={`A customer chose you for ${selectedPendingCount} ${selectedPendingCount === 1 ? 'job' : 'jobs'}`}
            action={
              <Button asChild size="sm">
                <Link href="/provider/leads">Open</Link>
              </Button>
            }
          >
            Confirm to lock the booking. Credits aren&apos;t charged until you accept.
          </AlertCallout>
        )}

        {lowOnCredits && (
          <AlertCallout
            tone="warning"
            title={walletBalance.totalCreditBalance === 0 ? "You're out of credits" : 'Only 1 credit left'}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/provider/credits">Top up</Link>
              </Button>
            }
          >
            Top up to keep accepting customer-selected jobs.
          </AlertCallout>
        )}

        {/* Credits hero card */}
        <section>
          <div
            className="relative overflow-hidden rounded-[24px] p-5"
            style={{ background: 'var(--ink)' }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-25"
              style={{ background: 'radial-gradient(circle, rgba(139,63,232,0.8), transparent 70%)' }}
            />
            <div className="relative z-[1]">
              <div className="flex items-center gap-1.5 mb-3">
                <Sparkles size={14} className="text-[var(--brand-purple)]" />
                <p className="text-[11.5px] font-bold uppercase tracking-[0.05em] text-white/60">
                  Credits balance
                </p>
              </div>
              <div className="flex items-end gap-2 mb-1">
                <span className="text-[48px] font-bold leading-none tracking-[-0.03em] text-white tabular-nums">
                  {walletBalance.totalCreditBalance}
                </span>
                <span className="text-[14px] text-white/60 pb-2">
                  credits · R{(walletBalance.totalCreditBalance * 50).toLocaleString()}
                </span>
              </div>
              <p className="text-[12.5px] text-white/50 mb-4">
                Each accepted customer-selected job uses 1 credit
              </p>
              <div className="flex gap-2">
                <Button asChild size="sm" className="flex-1 bg-white text-[var(--ink)] hover:bg-white/90">
                  <Link href="/provider/credits">
                    <Coins size={14} />
                    + Top up
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10">
                  <Link href={termsUrl}>Terms</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Stats row - 3 cards */}
        <section>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-[7px] text-[var(--brand-purple)]"
                     style={{ background: 'rgba(139,63,232,0.10)' }}>
                  <ListChecks size={13} />
                </div>
              </div>
              <p className="text-[22px] font-bold tracking-[-0.03em] text-[var(--ink)] leading-none mb-1 tabular-nums">
                {activeJobs.length}
              </p>
              <p className="text-[11px] text-[var(--ink-mute)] leading-tight">Active jobs</p>
            </div>
            <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-[7px] text-[var(--color-teal)]"
                     style={{ background: 'color-mix(in srgb, var(--color-teal) 10%, transparent)' }}>
                  <CheckCircle2 size={13} />
                </div>
              </div>
              <p className="text-[22px] font-bold tracking-[-0.03em] text-[var(--ink)] leading-none mb-1 tabular-nums">
                {completedJobsCount}
              </p>
              <p className="text-[11px] text-[var(--ink-mute)] leading-tight">Completed</p>
            </div>
            <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-3.5">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-[7px] text-[var(--color-amber)]"
                     style={{ background: 'color-mix(in srgb, var(--color-amber) 12%, transparent)' }}>
                  <Star size={13} />
                </div>
              </div>
              <p className="text-[22px] font-bold tracking-[-0.03em] text-[var(--ink)] leading-none mb-1 tabular-nums">
                {rating}
              </p>
              <p className="text-[11px] text-[var(--ink-mute)] leading-tight">Rating ★</p>
            </div>
          </div>
        </section>

        {/* Availability toggle */}
        <section>
          <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-4">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-[11px] shrink-0"
                style={provider.availableNow
                  ? { background: 'color-mix(in srgb, var(--color-teal) 12%, transparent)', color: 'var(--color-teal)' }
                  : { background: 'var(--card-alt, #F4F4F7)', color: 'var(--ink-mute)' }}
              >
                {provider.availableNow ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
                  {provider.availableNow ? "You're available now" : "You're not available"}
                </p>
                <p className="text-[12px] text-[var(--ink-mute)] mt-0.5">
                  {provider.availableNow
                    ? 'You can receive new leads and job requests.'
                    : 'Toggle on to start receiving leads in your area.'}
                </p>
              </div>
              <form action={toggleAvailability}>
                <button
                  type="submit"
                  aria-label={provider.availableNow ? 'Set unavailable' : 'Set available'}
                  className="relative w-[46px] h-[26px] rounded-full transition-colors shrink-0"
                  style={{
                    background: provider.availableNow ? 'var(--color-teal)' : 'var(--border)',
                  }}
                >
                  <span
                    className="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-[left] duration-200"
                    style={{ left: provider.availableNow ? 'calc(100% - 23px)' : '3px' }}
                  />
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* New leads preview */}
        {pendingLeads.length > 0 && (
          <section>
            <SectionLabel className="mb-3" action={
              <Link href="/provider/leads" className="text-[13px] font-semibold text-[var(--brand-purple)]">
                See all ({pendingOpportunitiesCount})
              </Link>
            }>
              New leads
            </SectionLabel>
            <div className="space-y-2.5">
              {pendingLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/provider/leads/${lead.id}`}
                  className="block bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[var(--shadow-float)] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-px p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-[15px] font-bold text-[var(--ink)] tracking-[-0.015em] capitalize">
                      {lead.jobRequest.category?.replaceAll('_', ' ') ?? 'Job request'}
                    </p>
                    <UrgencyChip urgency={lead.jobRequest.urgency ?? null} />
                  </div>
                  {lead.jobRequest.address?.suburb && (
                    <p className="flex items-center gap-1 text-[12.5px] text-[var(--ink-mute)] mb-3">
                      <MapPin size={12} aria-hidden />
                      {lead.jobRequest.address.suburb}
                    </p>
                  )}
                  <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[12.5px] font-semibold text-[var(--brand-purple)]">
                      <Sparkles size={13} aria-hidden />
                      Lead unlock: <b>1 credit</b>
                    </span>
                    <span className="text-[12.5px] font-semibold text-[var(--ink-mute)]">
                      {lead.status === 'VIEWED' ? 'Viewed' : 'New'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {pendingLeads.length === 0 && pendingOpportunitiesCount === 0 && (
          <section>
            <SectionLabel className="mb-3">New leads</SectionLabel>
            <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-6 text-center">
              <div
                className="w-12 h-12 rounded-[16px] flex items-center justify-center mx-auto mb-3"
                style={{ background: 'var(--brand-gradient-soft, rgba(139,63,232,0.08))', color: 'var(--brand-purple)' }}
              >
                <Inbox size={22} />
              </div>
              <p className="text-[14px] font-semibold text-[var(--ink)] mb-1">No new leads right now</p>
              <p className="text-[12.5px] text-[var(--ink-mute)]">
                Stay available - we&apos;ll WhatsApp you when a lead arrives.
              </p>
            </div>
          </section>
        )}

        {/* Profile completeness */}
        {profileIncomplete && (
          <section className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-5">
            <CompletionMeter
              value={profileCompleteness.percentage}
              label="Profile completeness"
              hint={
                profileCompleteness.missing.length > 0
                  ? `Add ${profileCompleteness.missing.slice(0, 3).join(', ')} to win more jobs.`
                  : 'Your profile shows up well in customer shortlists.'
              }
            />
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link href="/provider/profile">Complete profile</Link>
            </Button>
          </section>
        )}

        {/* Quick links */}
        <section className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] overflow-hidden divide-y divide-[var(--border)]">
          {[
            { href: '/provider/credits', icon: <Wallet size={18} />, label: 'Top up / view credits', hue: 'var(--brand-purple)' },
            { href: '/provider/voucher', icon: <Tag size={18} />, label: 'Redeem voucher code', hue: 'var(--color-teal)' },
            { href: '/provider/earnings', icon: <Coins size={18} />, label: 'Earnings', hue: 'var(--color-teal)' },
            { href: termsUrl, icon: <Clock3 size={18} />, label: 'Credits terms & rules', hue: 'var(--ink-mute)' },
          ].map(({ href, icon, label, hue }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--card-alt)] transition-colors"
            >
              <div
                className="flex items-center justify-center w-9 h-9 rounded-[11px] shrink-0"
                style={{ background: `${hue}15`, color: hue }}
              >
                {icon}
              </div>
              <span className="flex-1 text-[14px] font-semibold text-[var(--ink)] tracking-[-0.01em]">
                {label}
              </span>
              <ArrowRight size={16} className="text-[var(--ink-soft)]" />
            </Link>
          ))}
        </section>

        {/* Active / in-progress jobs */}
        <section>
          <SectionLabel className="mb-3">In progress ({activeJobs.length})</SectionLabel>
          {activeJobs.length === 0 ? (
            <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-6 text-center">
              <p className="text-[14px] font-semibold text-[var(--ink)] mb-1">No active jobs right now</p>
              <p className="text-[13px] text-[var(--ink-mute)]">
                When a customer books you, the job appears here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((job) => (
                <JobCard key={job.id} job={job} basePath="/provider" />
              ))}
            </div>
          )}
        </section>

        {upcomingJobs.length > 0 && (
          <section>
            <SectionLabel className="mb-3">Upcoming ({upcomingJobs.length})</SectionLabel>
            <div className="space-y-3">
              {upcomingJobs.map((job) => (
                <JobCard key={job.id} job={job} basePath="/provider" />
              ))}
            </div>
          </section>
        )}

        {recentCompletedJobs.length > 0 && (
          <section>
            <SectionLabel className="mb-3">
              Recent history ({completedJobsCount} completed)
            </SectionLabel>
            <div className="space-y-3">
              {recentCompletedJobs.map((job) => (
                <JobCard key={job.id} job={job} basePath="/provider" />
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}
