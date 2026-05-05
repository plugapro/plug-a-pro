import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, MapPin, Clock, Phone } from 'lucide-react'
import type {
  Job,
  Booking,
  Match,
  JobRequest,
  Customer,
  Address,
} from '@prisma/client'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'

type JobWithContext = Job & {
  booking: Booking & {
    match: Match & {
      jobRequest: JobRequest & {
        customer: Customer
        address: Address | null
      }
    }
  }
}

interface JobCardProps {
  job: JobWithContext
  /** Route prefix — provider or legacy technician. */
  basePath?: '/provider' | '/technician'
  /** Optional next-action label shown to the right of the status badge. */
  nextAction?: string
  /** Optional price/quote summary shown bottom-left. */
  priceLabel?: React.ReactNode
  className?: string
}

/**
 * Operational job card used on the provider inbox and dashboard.
 * Surfaces the four pieces of information a provider needs at a glance:
 *  1. Status (badge)
 *  2. Customer + suburb
 *  3. Scheduled time
 *  4. Quote/price + next action
 *
 * Generous tap target, single tap to detail. Avoids the older pattern of
 * a category-only headline that didn't help on a busy day.
 */
export function JobCard({
  job,
  basePath = '/provider',
  nextAction,
  priceLabel,
  className,
}: JobCardProps) {
  const { jobRequest } = job.booking.match
  const { customer, address } = jobRequest
  const suburb = address?.suburb ?? address?.city ?? null
  const scheduledWindow = job.booking.scheduledWindow ?? null
  const scheduledDate = job.booking.scheduledDate
    ? new Date(job.booking.scheduledDate)
    : null

  return (
    <Link
      href={`${basePath}/jobs/${job.id}`}
      className={cn(
        'group block rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-soft)] transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold capitalize text-foreground">
            {jobRequest.category.replaceAll('_', ' ')}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {customer.name}
            {customer.phone ? (
              <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
                <Phone className="size-3" />
                {customer.phone.replace(/^\+27/, '0')}
              </span>
            ) : null}
          </p>
        </div>
        <StatusBadge status={job.status} type="job" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {suburb ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{suburb}</span>
          </span>
        ) : null}
        {scheduledDate ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 shrink-0" />
            <span className="truncate">
              {scheduledDate.toLocaleDateString('en-ZA', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
              {scheduledWindow ? ` · ${scheduledWindow}` : null}
            </span>
          </span>
        ) : null}
      </div>

      {(priceLabel || nextAction) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {priceLabel ?? '—'}
          </span>
          {nextAction ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              {nextAction}
              <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          ) : null}
        </div>
      )}
    </Link>
  )
}
