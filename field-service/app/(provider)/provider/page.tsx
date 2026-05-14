// ─── Provider: Home dashboard ─────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  Briefcase,
  CheckCircle2,
  Clock3,
  Coins,
  Inbox,
  ListChecks,
  Sparkles,
  Wallet,
  ToggleRight,
  ArrowRight,
} from 'lucide-react'
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

export const metadata = buildMetadata({ title: 'Provider Home', noIndex: true })

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

  return (
    <div className="pb-6 screen-enter">
      {/* Header strip */}
      <div className="relative flex items-center gap-3 px-[18px] pt-[60px] pb-1.5">
        <AppLogo href="/provider" compact className="h-8" priority />
        <div className="flex-1" />
        <span className="h-7 px-3 rounded-full bg-[var(--card-alt)] text-[var(--ink-mute)] text-[12px] font-semibold flex items-center">
          Provider
        </span>
      </div>

      {/* Hero greeting */}
      <div className="px-[18px] pt-3 pb-5">
        <p className="text-[12px] font-bold tracking-[0.05em] uppercase text-[var(--brand-purple)] mb-1">
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
                    Top up
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10">
                  <Link href={termsUrl}>Terms</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Stats row */}
        <section>
          <SectionLabel className="mb-3" action={
            <Link href="/provider/leads" className="text-[13px] font-semibold text-[var(--brand-purple)]">
              See leads
            </Link>
          }>
            Today
          </SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/provider/leads" className="block">
              <StatCard
                label="New opportunities"
                value={pendingOpportunitiesCount}
                icon={<Inbox className="size-3.5" />}
                tone={pendingOpportunitiesCount > 0 ? 'info' : 'neutral'}
              />
            </Link>
            <Link href="/provider/leads" className="block">
              <StatCard
                label="Awaiting acceptance"
                value={selectedPendingCount}
                icon={<Clock3 className="size-3.5" />}
                tone={selectedPendingCount > 0 ? 'warning' : 'neutral'}
              />
            </Link>
            <StatCard
              label="Active jobs"
              value={activeJobs.length}
              icon={<ListChecks className="size-3.5" />}
              tone="brand"
            />
            <StatCard
              label="Completed"
              value={completedJobsCount}
              icon={<CheckCircle2 className="size-3.5" />}
              tone="success"
            />
          </div>
        </section>

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
            { href: '/provider/availability', icon: <ToggleRight size={18} />, label: 'Manage availability', hue: '#0FA28A' },
            { href: '/provider/credits', icon: <Wallet size={18} />, label: 'Top up / view credits', hue: '#8B3FE8' },
            { href: termsUrl, icon: <Coins size={18} />, label: 'Credits terms & rules', hue: '#5B5B66' },
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

        {/* Active jobs */}
        <section>
          <SectionLabel className="mb-3">Active ({activeJobs.length})</SectionLabel>
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
