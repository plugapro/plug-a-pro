// ─── Provider: Job list ────────────────────────────────────────────────────────
// Today's active jobs + upcoming scheduled jobs.

export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { JobCard } from '@/components/technician/JobCard'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { getProviderWalletBalance } from '@/lib/provider-wallet'
import { getProviderTermsUrl } from '@/lib/provider-credit-copy'

export const metadata = buildMetadata({ title: 'My Jobs', noIndex: true })

export default async function ProviderHomePage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
  })

  if (!provider) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground">
        <p>Your provider account is not yet set up.</p>
        <p className="text-sm mt-1">Please contact support.</p>
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
                address:  true,
              },
            },
          },
        },
      },
    },
  } as const

  const [activeJobs, upcomingJobs, walletBalance] = await Promise.all([
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
    getProviderWalletBalance(provider.id),
  ])
  const termsUrl = getProviderTermsUrl()

  return (
    <div className="px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My Jobs</h1>
        <p className="text-sm text-muted-foreground">{provider.name}</p>
      </div>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Credits
            </h2>
            <p className="mt-1 text-3xl font-semibold tracking-normal">
              {walletBalance.totalCreditBalance}
            </p>
            <p className="text-sm text-muted-foreground">
              Each accepted lead uses 1 credit
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/provider/credits">History</Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Starter</p>
            <p className="text-lg font-semibold">{walletBalance.promoCreditBalance}</p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Purchased</p>
            <p className="text-lg font-semibold">{walletBalance.paidCreditBalance}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-2">
        <Button asChild variant="outline" className="w-full">
          <Link href="/provider/availability">Manage Availability</Link>
        </Button>

        <Button asChild variant="outline" className="w-full">
          <Link href="/provider/credits">Top Up / View Credits</Link>
        </Button>

        <Button asChild variant="ghost" className="w-full">
          <Link href={termsUrl}>Provider Terms & Credit Rules</Link>
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Active ({activeJobs.length})
        </h2>
        {activeJobs.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No active jobs right now.</p>
        )}
        {activeJobs.map((job) => (
          <JobCard key={job.id} job={job} basePath="/provider" />
        ))}
      </section>

      {upcomingJobs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Upcoming ({upcomingJobs.length})
          </h2>
          {upcomingJobs.map((job) => (
            <JobCard key={job.id} job={job} basePath="/provider" />
          ))}
        </section>
      )}

      {activeJobs.length === 0 && upcomingJobs.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center space-y-2">
          <p className="text-muted-foreground">No jobs assigned yet.</p>
          <p className="text-sm text-muted-foreground">
            You&apos;ll receive a WhatsApp message when a job is ready.
          </p>
        </div>
      )}
    </div>
  )
}
