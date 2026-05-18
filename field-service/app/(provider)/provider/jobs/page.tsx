// ─── Provider: Jobs list ──────────────────────────────────────────────────────
// Full job history grouped by status. Unlike the home page (which shows the
// most recent 5 completed), this page paginates all completed jobs and shows
// every group in one scannable view.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Briefcase, CheckCircle2, Clock3, ListChecks } from 'lucide-react'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { JobCard } from '@/components/shared/JobCard'
import { SectionLabel } from '@/components/ui/section-label'
import { ChevronLeft } from 'lucide-react'

export const metadata = buildMetadata({ title: 'My Jobs', noIndex: true })

const PAGE_SIZE = 20

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

export default async function ProviderJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await requireProvider()
  const { page: pageParam } = await searchParams
  const page = Math.max(1, parseInt(pageParam ?? '1', 10))
  const skip = (page - 1) * PAGE_SIZE

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true },
  })

  if (!provider) {
    return (
      <div className="px-[18px] pt-[60px] pb-10">
        <p className="text-[14px] text-[var(--ink-mute)] text-center">
          Provider account not set up. Contact support.
        </p>
      </div>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const [
    activeJobs,
    upcomingJobs,
    completedJobs,
    totalCompleted,
    pendingConfirmationJobs,
    awaitingQuoteMatches,
    creditRequiredLeads,
    customerSelectedLeads,
  ] = await Promise.all([
      db.job.findMany({
        where: {
          providerId: provider.id,
          status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL'] },
          booking: { scheduledDate: { lt: tomorrow } },
        },
        include: jobInclude,
        orderBy: { booking: { scheduledDate: 'asc' } },
      }),
      db.job.findMany({
        where: {
          providerId: provider.id,
          status: 'SCHEDULED',
          booking: { scheduledDate: { gte: tomorrow } },
        },
        include: jobInclude,
        orderBy: { booking: { scheduledDate: 'asc' } },
      }),
      db.job.findMany({
        where: {
          providerId: provider.id,
          status: 'COMPLETED',
        },
        include: jobInclude,
        orderBy: { completedAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
      db.job.count({
        where: { providerId: provider.id, status: 'COMPLETED' },
      }),
      db.job.findMany({
        where: {
          providerId: provider.id,
          status: 'PENDING_COMPLETION_CONFIRMATION',
        },
        include: jobInclude,
        orderBy: { updatedAt: 'desc' },
      }),
      // Locked leads with a Match but no Booking yet — provider needs to
      // submit a quote (or customer needs to approve a submitted one).
      // Includes all pre-booking Match statuses, not just MATCHED.
      db.match.findMany({
        where: {
          providerId: provider.id,
          status: { in: ['MATCHED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETE', 'QUOTED', 'QUOTE_DECLINED'] },
          booking: null,
        },
        include: {
          jobRequest: { include: { customer: true, address: true } },
          quotes: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Leads where the provider accepted but has insufficient credits.
      // No Match row exists yet — surfaced here so the provider knows they
      // need to top up to confirm their slot.
      db.lead.findMany({
        where: {
          providerId: provider.id,
          status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
        },
        include: {
          jobRequest: { include: { customer: true, address: true } },
        },
        orderBy: { providerAcceptedAt: 'desc' },
      }),
      // Leads where a customer selected this provider but the provider has not
      // yet confirmed acceptance. They need to tap confirm_accept on WhatsApp.
      // Surfacing these prevents a provider missing the confirmation message from
      // silently losing their slot.
      db.lead.findMany({
        where: {
          providerId: provider.id,
          status: 'CUSTOMER_SELECTED',
        },
        include: {
          jobRequest: { include: { customer: true, address: true } },
        },
        orderBy: { customerSelectedAt: 'desc' },
      }),
  ]).catch((err: unknown) => {
    console.error('[provider-jobs] failed to load jobs', {
      providerId: provider.id,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  })

  const totalPages = Math.max(1, Math.ceil(totalCompleted / PAGE_SIZE))

  return (
    <div className="pb-8 screen-enter">

      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5 flex items-center gap-3">
        <Link href="/provider" aria-label="Back to home">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <ChevronLeft className="w-5 h-5" style={{ color: 'var(--ink)' }} />
          </div>
        </Link>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--brand-purple)]">
            Provider portal
          </p>
          <h1 className="text-[28px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
            My jobs
          </h1>
        </div>
      </div>

      <div className="px-[18px] space-y-6">

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-3.5">
            <div className="flex items-center justify-center w-6 h-6 rounded-[7px] mb-2"
                 style={{ background: 'rgba(139,63,232,0.10)', color: 'var(--brand-purple)' }}>
              <ListChecks size={13} />
            </div>
            <p className="text-[22px] font-bold tracking-[-0.03em] text-[var(--ink)] leading-none mb-1 tabular-nums">
              {activeJobs.length + awaitingQuoteMatches.length + creditRequiredLeads.length + customerSelectedLeads.length}
            </p>
            <p className="text-[11px] text-[var(--ink-mute)] leading-tight">Active</p>
          </div>
          <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-3.5">
            <div className="flex items-center justify-center w-6 h-6 rounded-[7px] mb-2"
                 style={{ background: 'color-mix(in srgb, var(--color-amber) 12%, transparent)', color: 'var(--color-amber)' }}>
              <Clock3 size={13} />
            </div>
            <p className="text-[22px] font-bold tracking-[-0.03em] text-[var(--ink)] leading-none mb-1 tabular-nums">
              {upcomingJobs.length}
            </p>
            <p className="text-[11px] text-[var(--ink-mute)] leading-tight">Upcoming</p>
          </div>
          <div className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-3.5">
            <div className="flex items-center justify-center w-6 h-6 rounded-[7px] mb-2"
                 style={{ background: 'color-mix(in srgb, var(--color-teal) 10%, transparent)', color: 'var(--color-teal)' }}>
              <CheckCircle2 size={13} />
            </div>
            <p className="text-[22px] font-bold tracking-[-0.03em] text-[var(--ink)] leading-none mb-1 tabular-nums">
              {totalCompleted}
            </p>
            <p className="text-[11px] text-[var(--ink-mute)] leading-tight">Completed</p>
          </div>
        </div>

        {/* Customer chose you — waiting for your acceptance via WhatsApp */}
        {customerSelectedLeads.length > 0 && (
          <section>
            <SectionLabel className="mb-3">
              Confirm acceptance ({customerSelectedLeads.length})
            </SectionLabel>
            <div className="space-y-3">
              {customerSelectedLeads.map((lead) => {
                const customerName = lead.jobRequest.customer?.name ?? 'Customer'
                const area = [lead.jobRequest.address?.suburb, lead.jobRequest.address?.city]
                  .filter(Boolean)
                  .join(', ')
                return (
                  <div
                    key={lead.id}
                    className="bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-[var(--ink)] truncate">
                          {lead.jobRequest.category}
                        </p>
                        <p className="text-[12px] text-[var(--ink-mute)] truncate">
                          {customerName}{area ? ` · ${area}` : ''}
                        </p>
                      </div>
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{
                          background: 'color-mix(in srgb, var(--brand-purple) 12%, transparent)',
                          color: 'var(--brand-purple)',
                        }}
                      >
                        Chosen!
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--ink-mute)]">
                      A customer selected you for this job. Reply on WhatsApp to confirm acceptance (1 credit).
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Top up required — accepted leads stalled at CREDIT_REQUIRED */}
        {creditRequiredLeads.length > 0 && (
          <section>
            <SectionLabel className="mb-3">
              Top up required ({creditRequiredLeads.length})
            </SectionLabel>
            <div className="space-y-3">
              {creditRequiredLeads.map((lead) => {
                const customerName = lead.jobRequest.customer?.name ?? 'Customer'
                const area = [lead.jobRequest.address?.suburb, lead.jobRequest.address?.city]
                  .filter(Boolean)
                  .join(', ')
                return (
                  <Link
                    key={lead.id}
                    href="/provider/credits"
                    className="block bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-4 transition-shadow hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-[var(--ink)] truncate">
                          {lead.jobRequest.category}
                        </p>
                        <p className="text-[12px] text-[var(--ink-mute)] truncate">
                          {customerName}{area ? ` · ${area}` : ''}
                        </p>
                      </div>
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{
                          background: 'color-mix(in srgb, var(--color-red, #ef4444) 12%, transparent)',
                          color: 'var(--color-red, #ef4444)',
                        }}
                      >
                        Top up
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--ink-mute)]">
                      You accepted this job but need more credits to confirm your slot. Tap to top up.
                    </p>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Awaiting your quote (locked leads with no Booking yet) */}
        {awaitingQuoteMatches.length > 0 && (
          <section>
            <SectionLabel className="mb-3">
              Awaiting your quote ({awaitingQuoteMatches.length})
            </SectionLabel>
            <div className="space-y-3">
              {awaitingQuoteMatches.map((match) => {
                const customerName = match.jobRequest.customer?.name ?? 'Customer'
                const area = [match.jobRequest.address?.suburb, match.jobRequest.address?.city]
                  .filter(Boolean)
                  .join(', ')
                return (
                  <Link
                    key={match.id}
                    href={`/provider/quotes/${match.id}`}
                    className="block bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] p-4 transition-shadow hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-[var(--ink)] truncate">
                          {match.jobRequest.category}
                        </p>
                        <p className="text-[12px] text-[var(--ink-mute)] truncate">
                          {customerName}{area ? ` · ${area}` : ''}
                        </p>
                      </div>
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{
                          background: 'color-mix(in srgb, var(--color-amber) 14%, transparent)',
                          color: 'var(--color-amber)',
                        }}
                      >
                        Quote needed
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--ink-mute)]">
                      Tap to send your quote and unlock the customer's contact details.
                    </p>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Pending confirmation */}
        {pendingConfirmationJobs.length > 0 && (
          <section>
            <SectionLabel className="mb-3">
              Awaiting customer confirmation ({pendingConfirmationJobs.length})
            </SectionLabel>
            <div className="space-y-3">
              {pendingConfirmationJobs.map((job) => (
                <JobCard key={job.id} job={job} basePath="/provider" />
              ))}
            </div>
          </section>
        )}

        {/* Active / in-progress */}
        <section>
          <SectionLabel className="mb-3">In progress ({activeJobs.length})</SectionLabel>
          {activeJobs.length === 0 ? (
            <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-6 text-center">
              <div
                className="w-12 h-12 rounded-[16px] flex items-center justify-center mx-auto mb-3"
                style={{ background: 'rgba(139,63,232,0.08)', color: 'var(--brand-purple)' }}
              >
                <Briefcase size={22} />
              </div>
              <p className="text-[14px] font-semibold text-[var(--ink)] mb-1">No active jobs</p>
              <p className="text-[12.5px] text-[var(--ink-mute)]">
                Jobs you accept or that are in progress will appear here.
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

        {/* Upcoming */}
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

        {/* Completed — paginated */}
        <section>
          <SectionLabel className="mb-3">
            Completed history ({totalCompleted})
          </SectionLabel>
          {completedJobs.length === 0 ? (
            <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-6 text-center">
              <p className="text-[14px] font-semibold text-[var(--ink)] mb-1">No completed jobs yet</p>
              <p className="text-[12.5px] text-[var(--ink-mute)]">
                Finished jobs will be recorded here for your reference.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {completedJobs.map((job) => (
                <JobCard key={job.id} job={job} basePath="/provider" />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)]">
              {page > 1 ? (
                <Link
                  href={`/provider/jobs?page=${page - 1}`}
                  className="text-[13px] font-semibold text-[var(--brand-purple)]"
                >
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-[12px] text-[var(--ink-mute)]">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/provider/jobs?page=${page + 1}`}
                  className="text-[13px] font-semibold text-[var(--brand-purple)]"
                >
                  Older →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
