// ─── Customer: My bookings ────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, MapPin } from 'lucide-react'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import { StatusDot, type StatusTone } from '@/components/ui/status-dot'
import { cn } from '@/lib/utils'

export const metadata = buildMetadata({ title: 'My Bookings' })

function filterLink(
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const merged = { ...current, ...patch }
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `/bookings?${qs}` : '/bookings'
}

function requestTone(status: string): StatusTone {
  if (['MATCHED', 'ACCEPTED_LOCKED'].includes(status)) return 'success'
  if (['SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'].includes(status)) return 'warn'
  if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(status)) return 'danger'
  return 'warn'
}

function requestLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING_VALIDATION: 'Pending',
    OPEN: 'Matching',
    MATCHING: 'Matching',
    SHORTLIST_READY: 'Choose provider',
    PROVIDER_CONFIRMATION_PENDING: 'Confirming',
    ACCEPTED_LOCKED: 'Accepted',
    MATCHED: 'Matched',
    EXPIRED: 'Expired',
    CANCELLED: 'Cancelled',
  }
  return map[status] ?? status
}

function bookingTone(bookingStatus: string, jobStatus?: string | null): StatusTone {
  if (jobStatus === 'COMPLETED') return 'success'
  if (jobStatus === 'CANCELLED' || bookingStatus === 'CANCELLED') return 'danger'
  if (['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'].includes(jobStatus ?? '')) return 'success'
  return 'warn'
}

function bookingLabel(bookingStatus: string, jobStatus?: string | null): string {
  if (jobStatus) {
    const map: Record<string, string> = {
      SCHEDULED: 'Scheduled',
      EN_ROUTE: 'On the way',
      ARRIVED: 'Arrived',
      STARTED: 'In progress',
      PAUSED: 'Paused',
      AWAITING_APPROVAL: 'Needs approval',
      PENDING_COMPLETION_CONFIRMATION: 'Ready for sign-off',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
      FAILED: 'Failed',
    }
    if (map[jobStatus]) return map[jobStatus]
  }
  const bmap: Record<string, string> = {
    SCHEDULED: 'Scheduled',
    RESCHEDULED: 'Rescheduled',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
  }
  return bmap[bookingStatus] ?? bookingStatus
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 h-8 px-4 rounded-full text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap',
        active
          ? 'bg-[var(--ink)] text-[var(--card)]'
          : 'bg-[var(--card-alt)] text-[var(--ink)] hover:bg-[var(--border)]',
      )}
    >
      {children}
    </Link>
  )
}

export default async function CustomerBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; category?: string; status?: string }>
}) {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/bookings')}`)

  const customer = await resolveCustomerForSession(db, session)

  if (!customer) {
    return (
      <div className="px-[18px] pt-[60px] pb-8">
        <h1 className="text-[30px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
          Your bookings
        </h1>
        <p className="mt-2 text-[14.5px] text-[var(--ink-mute)]">
          No bookings found. Book your first service to get started.
        </p>
        <div className="mt-6">
          <Button asChild fullWidth size="md">
            <Link href="/services">Request a service</Link>
          </Button>
        </div>
      </div>
    )
  }

  const { site, category, status } = await searchParams
  const filters = { site, category, status }

  const [savedSites, allRequests] = await Promise.all([
    db.customerAddress.findMany({
      where: { customerId: customer.id },
      select: { id: true, label: true, suburb: true, city: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      take: 6,
    }),
    db.jobRequest.findMany({
      where: { customerId: customer.id },
      select: { category: true },
      distinct: ['category'],
    }),
  ])

  const distinctCategories = [...new Set(allRequests.map((r) => r.category).filter(Boolean))]
  const showSiteFilter = savedSites.length >= 1
  const showCategoryFilter = distinctCategories.length >= 1

  const addressFilter = site ? { addressId: site } : {}
  const categoryFilter = category ? { category } : {}
  const isCompleted = status === 'completed'
  const isActive = status === 'active'

  const requests = await db.jobRequest.findMany({
    where: {
      customerId: customer.id,
      status: isCompleted
        ? { in: ['CANCELLED', 'EXPIRED'] }
        : { notIn: ['EXPIRED', 'CANCELLED'] },
      OR: [
        { match: { is: null } },
        { match: { is: { booking: { is: null } } } },
      ],
      ...addressFilter,
      ...categoryFilter,
    },
    include: {
      address: { select: { suburb: true, city: true } },
      match: {
        include: {
          provider: { select: { name: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const bookings = await db.booking.findMany({
    where: {
      match: {
        jobRequest: {
          customerId: customer.id,
          ...categoryFilter,
          ...(site ? { addressId: site } : {}),
        },
      },
      ...(isCompleted ? { job: { status: 'COMPLETED' } } : {}),
      ...(isActive ? { job: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } } : {}),
    },
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              address: { select: { suburb: true, city: true } },
            },
          },
          provider: { select: { name: true, avatarUrl: true } },
        },
      },
      quote: { select: { amount: true } },
      job: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const hasResults = requests.length > 0 || bookings.length > 0

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-4">
        <h1 className="text-[30px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
          Your bookings
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--ink-mute)]">
          Active and recent requests
        </p>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 overflow-x-auto px-[18px] pb-1 scrollbar-hide">
        <FilterPill href={filterLink(filters, { status: undefined })} active={!status}>All</FilterPill>
        <FilterPill href={filterLink(filters, { status: 'active' })} active={status === 'active'}>Active</FilterPill>
        <FilterPill href={filterLink(filters, { status: 'completed' })} active={status === 'completed'}>Completed</FilterPill>
      </div>

      {/* Category filter pills */}
      {showCategoryFilter && (
        <div className="flex gap-2 overflow-x-auto px-[18px] pt-2 pb-1 scrollbar-hide">
          <FilterPill href={filterLink(filters, { category: undefined })} active={!category}>All categories</FilterPill>
          {distinctCategories.map((cat) => (
            <FilterPill key={cat} href={filterLink(filters, { category: cat })} active={category === cat}>
              <span className="capitalize">{cat.replaceAll('_', ' ')}</span>
            </FilterPill>
          ))}
        </div>
      )}

      {/* Site filter pills */}
      {showSiteFilter && (
        <div className="flex gap-2 overflow-x-auto px-[18px] pt-2 pb-1 scrollbar-hide">
          <FilterPill href={filterLink(filters, { site: undefined })} active={!site}>All sites</FilterPill>
          {savedSites.map((s) => (
            <FilterPill key={s.id} href={filterLink(filters, { site: s.id })} active={site === s.id}>
              {s.label ?? s.suburb ?? s.city ?? 'Site'}
            </FilterPill>
          ))}
        </div>
      )}

      <div className="px-[18px] pt-5 space-y-5">
        {/* Job requests */}
        {requests.length > 0 && (
          <section>
            <SectionLabel className="mb-3">Active requests</SectionLabel>
            <div className="space-y-3">
              {requests.map((request) => {
                const tone = requestTone(request.status)
                const label = requestLabel(request.status)
                const ref = request.id.slice(-8).toUpperCase()
                const providerName = request.match?.provider?.name ?? null
                return (
                  <Link
                    key={request.id}
                    href={`/requests/${request.id}`}
                    className="block bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[var(--shadow-float)] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-px overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[11.5px] text-[var(--ink-soft)] tracking-wider">
                          PAP-{ref}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <StatusDot tone={tone} size={7} />
                          <span className="text-[12px] font-semibold text-[var(--ink-mute)]">{label}</span>
                        </div>
                      </div>
                      <p className="text-[16px] font-bold text-[var(--ink)] tracking-[-0.015em]">
                        {request.title}
                      </p>
                      <p className="text-[13px] text-[var(--ink-mute)] mt-0.5 capitalize">
                        {request.category?.replaceAll('_', ' ')}{request.address ? ` · ${request.address.suburb}` : ''}
                      </p>
                      <div className="border-t border-[var(--border)] my-3" />
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-[var(--ink-mute)]">
                          {providerName ?? 'Finding providers…'}
                        </span>
                        <span className="h-8 px-4 rounded-[10px] bg-[var(--ink)] text-[var(--card)] text-[13px] font-semibold flex items-center">
                          View
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Confirmed bookings */}
        {bookings.length > 0 && (
          <section>
            <SectionLabel className="mb-3">Confirmed bookings</SectionLabel>
            <div className="space-y-3">
              {bookings.map((b) => {
                const jobRequest = b.match.jobRequest
                const address = jobRequest.address
                const tone = bookingTone(b.status, b.job?.status)
                const label = bookingLabel(b.status, b.job?.status)
                const ref = b.id.slice(-8).toUpperCase()
                const providerName = b.match.provider?.name ?? null
                const amount = b.quote.amount ? `R ${Number(b.quote.amount).toFixed(0)}` : null
                const dateStr = b.scheduledDate
                  ? b.scheduledDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
                  : 'Date TBC'
                return (
                  <Link
                    key={b.id}
                    href={`/bookings/${b.id}`}
                    className="block bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[var(--shadow-float)] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-px overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[11.5px] text-[var(--ink-soft)] tracking-wider">
                          PAP-{ref}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <StatusDot tone={tone} size={7} />
                          <span className="text-[12px] font-semibold text-[var(--ink-mute)]">{label}</span>
                        </div>
                      </div>
                      <p className="text-[16px] font-bold text-[var(--ink)] tracking-[-0.015em] capitalize">
                        {jobRequest.category?.replaceAll('_', ' ')}
                      </p>
                      <p className="text-[13px] text-[var(--ink-mute)] mt-0.5">
                        {dateStr}
                        {address ? ` · ${address.suburb}` : ''}
                        {amount ? ` · ${amount}` : ''}
                      </p>
                      <div className="border-t border-[var(--border)] my-3" />
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-[var(--ink-mute)]">
                          {providerName ?? '—'}
                        </span>
                        <span className="h-8 px-4 rounded-[10px] bg-[var(--ink)] text-[var(--card)] text-[13px] font-semibold flex items-center">
                          View
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!hasResults && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-16 h-16 rounded-[20px] brand-gradient-soft flex items-center justify-center mb-4">
              <MapPin size={28} className="text-[var(--brand-purple)]" />
            </div>
            <p className="text-[16px] font-bold text-[var(--ink)] tracking-[-0.01em] mb-1">
              {site || category || status ? 'No results' : 'No bookings yet'}
            </p>
            <p className="text-[13.5px] text-[var(--ink-mute)] mb-6 max-w-[260px]">
              {site || category || status
                ? 'Try a different filter combination.'
                : 'When you request a service it\'ll appear here.'}
            </p>
            {!site && !category && !status && (
              <Button asChild size="md">
                <Link href="/services">Request a service</Link>
              </Button>
            )}
          </div>
        )}

        {/* Bottom CTA */}
        {hasResults && (
          <Button asChild fullWidth variant="secondary" size="md">
            <Link href="/services">
              <Plus size={18} />
              Request another service
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
