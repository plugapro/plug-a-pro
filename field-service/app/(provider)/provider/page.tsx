// ─── Provider: Job list ────────────────────────────────────────────────────────
// Today's active jobs + upcoming scheduled jobs.

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
} from 'lucide-react'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { JobCard } from '@/components/shared/JobCard'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatCard } from '@/components/shared/StatCard'
import { CompletionMeter } from '@/components/shared/CompletionMeter'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { EmptyState } from '@/components/shared/EmptyState'
import { getProviderWalletBalance } from '@/lib/provider-wallet'
import { getProviderTermsUrl } from '@/lib/provider-credit-copy'
import { calculateProviderProfileCompleteness } from '@/lib/provider-pwa-dashboard'

export const metadata = buildMetadata({ title: 'My Jobs', noIndex: true })

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
      <div className="px-4 py-10">
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
    completedJobsCount,
    pendingOpportunitiesCount,
    selectedPendingCount,
    walletBalance,
  ] = await Promise.all([
    db.job.findMany({
      where: {
        providerId: provider.id,
        status: {
          in: [
            'SCHEDULED',
            'EN_ROUTE',
            'ARRIVED',
            'STARTED',
            'PAUSED',
            'AWAITING_APPROVAL',
          ],
        },
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
    db.job.count({
      where: {
        providerId: provider.id,
        status: 'COMPLETED',
      },
    }),
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

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <PageHeader
        eyebrow="Provider"
        title={`Hi ${provider.name?.split(' ')[0] ?? 'there'}`}
        description="Your jobs, leads, and credits at a glance."
      />

      {selectedPendingCount > 0 ? (
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
      ) : null}

      {lowOnCredits ? (
        <AlertCallout
          tone="warning"
          title={
            walletBalance.totalCreditBalance === 0
              ? 'You&apos;re out of credits'
              : 'Only 1 credit left'
          }
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/provider/credits">Top up</Link>
            </Button>
          }
        >
          Top up to keep accepting new leads — each accepted lead uses 1 credit.
        </AlertCallout>
      ) : null}

      <section className="space-y-3">
        <h2 className="app-kicker">Your wallet</h2>
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Available credits
              </p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                {walletBalance.totalCreditBalance}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Each accepted lead uses 1 credit
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/provider/credits">History</Link>
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatCard
              label="Starter"
              value={walletBalance.promoCreditBalance}
              icon={<Sparkles className="size-3.5" />}
              tone="brand"
            />
            <StatCard
              label="Purchased"
              value={walletBalance.paidCreditBalance}
              icon={<Wallet className="size-3.5" />}
              tone="info"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="app-kicker">Today</h2>
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

      <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-soft)]">
        <CompletionMeter
          value={profileCompleteness.percentage}
          label="Profile completeness"
          hint={
            profileCompleteness.missing.length > 0
              ? `Add ${profileCompleteness.missing.slice(0, 3).join(', ')} to win more jobs.`
              : 'Your profile shows up well in customer shortlists.'
          }
        />
        {profileIncomplete ? (
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/provider/profile">Complete profile</Link>
          </Button>
        ) : null}
      </section>

      <section className="grid gap-2">
        <Button asChild variant="outline" className="w-full justify-start">
          <Link href="/provider/availability">
            <Coins className="size-4" />
            Manage availability
          </Link>
        </Button>
        <Button asChild variant="outline" className="w-full justify-start">
          <Link href="/provider/credits">
            <Wallet className="size-4" />
            Top up / view credits
          </Link>
        </Button>
        <Button asChild variant="ghost" className="w-full justify-start">
          <Link href={termsUrl}>Provider terms &amp; credit rules</Link>
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="app-kicker">Active ({activeJobs.length})</h2>
        {activeJobs.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="size-5" />}
            title="No active jobs right now"
            description="When a customer books you, the job appears here. We&apos;ll WhatsApp you the moment it&apos;s ready."
          />
        ) : (
          activeJobs.map((job) => (
            <JobCard key={job.id} job={job} basePath="/provider" />
          ))
        )}
      </section>

      {upcomingJobs.length > 0 && (
        <section className="space-y-3">
          <h2 className="app-kicker">Upcoming ({upcomingJobs.length})</h2>
          {upcomingJobs.map((job) => (
            <JobCard key={job.id} job={job} basePath="/provider" />
          ))}
        </section>
      )}
    </div>
  )
}
