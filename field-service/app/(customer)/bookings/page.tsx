// ─── Customer: My bookings ────────────────────────────────────────────────────
// Lists all bookings for the authenticated customer with site/category/status
// filters via URL searchParams.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata = buildMetadata({ title: 'My Requests & Bookings' })

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

function FilterChip({
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
        'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
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
      <div className="mx-auto max-w-lg px-4 py-10">
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="No requests or bookings yet"
          description="Book your first service to get started."
          action={
            <Button asChild>
              <Link href="/services">Browse services</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const { site, category, status } = await searchParams
  const filters = { site, category, status }

  // ── Filter options ──────────────────────────────────────────────────────────

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
  const showSiteFilter = savedSites.length >= 2

  // ── Data queries with filters ───────────────────────────────────────────────

  const addressFilter = site
    ? { addressId: site }
    : {}

  const categoryFilter = category
    ? { category }
    : {}

  const isCompleted = status === 'completed'
  const isActive    = status === 'active'

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
          provider: { select: { name: true } },
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
        },
      },
      quote: { select: { amount: true } },
      job:   { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">My Requests &amp; Bookings</h1>

      {/* ── Status filter ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        <FilterChip href={filterLink(filters, { status: undefined })} active={!status}>
          All
        </FilterChip>
        <FilterChip href={filterLink(filters, { status: 'active' })} active={status === 'active'}>
          Active
        </FilterChip>
        <FilterChip href={filterLink(filters, { status: 'completed' })} active={status === 'completed'}>
          Completed
        </FilterChip>
      </div>

      {/* ── Category filter ── */}
      {distinctCategories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
          <FilterChip href={filterLink(filters, { category: undefined })} active={!category}>
            All categories
          </FilterChip>
          {distinctCategories.map((cat) => (
            <FilterChip
              key={cat}
              href={filterLink(filters, { category: cat })}
              active={category === cat}
            >
              <span className="capitalize">{cat.replaceAll('_', ' ')}</span>
            </FilterChip>
          ))}
        </div>
      )}

      {/* ── Site filter ── */}
      {showSiteFilter && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
          <FilterChip href={filterLink(filters, { site: undefined })} active={!site}>
            All sites
          </FilterChip>
          {savedSites.map((s) => (
            <FilterChip
              key={s.id}
              href={filterLink(filters, { site: s.id })}
              active={site === s.id}
            >
              {s.label ?? s.suburb ?? s.city ?? 'Site'}
            </FilterChip>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Active requests
            </h2>
            <p className="text-sm text-muted-foreground">
              Requests still being matched or awaiting a booking.
            </p>
          </div>

          {requests.map((request) => (
            <Link
              key={request.id}
              href={`/requests/${request.id}`}
              className="block rounded-xl border bg-card p-4 space-y-2 hover:bg-accent transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{request.title}</p>
                <StatusBadge status={request.status} type="jobRequest" />
              </div>

              {request.address && (
                <p className="text-sm text-muted-foreground">
                  {request.address.suburb}, {request.address.city}
                </p>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Created {request.createdAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                {request.match?.provider ? (
                  <span className="font-medium">{request.match.provider.name}</span>
                ) : (
                  <span className="font-medium">Pending match</span>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Ref: {request.id.slice(-8).toUpperCase()}
              </p>
            </Link>
          ))}
        </section>
      )}

      {bookings.length > 0 && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Confirmed bookings
            </h2>
            <p className="text-sm text-muted-foreground">
              Jobs that already have a booking and provider workflow attached.
            </p>
          </div>

          {bookings.map((b) => {
            const jobRequest = b.match.jobRequest
            const address    = jobRequest.address
            return (
              <Link
                key={b.id}
                href={`/bookings/${b.id}`}
                className="block rounded-xl border bg-card p-4 space-y-2 hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium capitalize">{jobRequest.category}</p>
                  {b.job
                    ? <StatusBadge status={b.job.status} type="job" />
                    : <StatusBadge status={b.status} type="booking" />}
                </div>

                {address && (
                  <p className="text-sm text-muted-foreground">
                    {address.suburb}, {address.city}
                  </p>
                )}

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {b.scheduledDate
                      ? b.scheduledDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                      : 'Date TBC'}
                    {b.scheduledWindow ? ` · ${b.scheduledWindow}` : ''}
                  </span>
                  <span className="font-medium">R {Number(b.quote.amount).toFixed(0)}</span>
                </div>

                <p className="text-xs text-muted-foreground">
                  Ref: {b.id.slice(-8).toUpperCase()}
                </p>

                {b.job?.status === 'COMPLETED' && (
                  <div className="pt-1">
                    <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                      <Link
                        href={`/book/${jobRequest.category}?template=${jobRequest.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Book again
                      </Link>
                    </Button>
                  </div>
                )}
              </Link>
            )
          })}
        </section>
      )}

      {requests.length === 0 && bookings.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center space-y-3">
          <p className="text-muted-foreground">
            {site || category || status
              ? 'No results for this filter combination.'
              : 'You have no requests or bookings yet.'}
          </p>
          {!site && !category && !status && (
            <Button asChild>
              <Link href="/services">Book a service</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
