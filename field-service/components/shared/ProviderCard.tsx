import * as React from 'react'
import Link from 'next/link'
import {
  BadgeCheck,
  ChevronRight,
  Clock,
  MapPin,
  Star,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export interface ProviderCardData {
  id: string
  name: string
  /** Short business or trading name shown beneath the personal name. */
  businessName?: string | null
  avatarUrl?: string | null
  /** Skills or service categories. Only the first three render as chips. */
  skills?: string[]
  serviceArea?: string | null
  /** Hourly labour rate in cents (R / 100). Materials excluded. */
  labourRateCents?: number | null
  averageRating?: number | null
  completedJobsCount?: number | null
  /** True when KYC and trust checks have passed. */
  verified?: boolean
  /** Optional response-time hint, e.g. "Replies within an hour". */
  responseTime?: string | null
  /** Available now / scheduled later — surfaced as a small tone chip. */
  availableNow?: boolean
}

interface ProviderCardProps {
  provider: ProviderCardData
  /** Where the card link points. Falls back to /providers/[id]. */
  href?: string
  /** Optional sticky CTA on the card (e.g. "Choose"). */
  action?: React.ReactNode
  className?: string
}

function formatLabourRate(cents: number | null | undefined): string | null {
  if (cents == null) return null
  const rands = cents / 100
  return `R${rands.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}/hr`
}

/**
 * Marketplace-grade provider card. Surfaces the trust signals customers
 * use to choose a provider on a phone screen: profile photo, name,
 * verification, rating, completed jobs, service area, labour rate, and
 * availability. Renders with consistent padding and tap target so it
 * works inside grids or single-column lists.
 *
 * Only renders fields that are actually present on the data — never
 * fabricates a star rating, completed job count, or labour rate.
 */
export function ProviderCard({
  provider,
  href,
  action,
  className,
}: ProviderCardProps) {
  const target = href ?? `/providers/${provider.id}`
  const rate = formatLabourRate(provider.labourRateCents)
  const ratingValue =
    typeof provider.averageRating === 'number'
      ? provider.averageRating.toFixed(1)
      : null
  const skillChips = (provider.skills ?? []).slice(0, 3)

  return (
    <Link
      href={target}
      className={cn(
        'group block rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-soft)] transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-muted text-muted-foreground"
        >
          {provider.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={provider.avatarUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <Wrench className="size-5" />
          )}
          {provider.verified ? (
            <span className="absolute -bottom-1 -right-1 inline-flex size-6 items-center justify-center rounded-full border border-card bg-primary text-primary-foreground shadow-sm">
              <BadgeCheck className="size-3.5" />
              <span className="sr-only">Verified provider</span>
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {provider.name}
              </p>
              {provider.businessName ? (
                <p className="truncate text-xs text-muted-foreground">
                  {provider.businessName}
                </p>
              ) : null}
            </div>
            <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {ratingValue ? (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <Star className="size-3.5 fill-current text-[var(--tone-warning-fg)]" />
                {ratingValue}
                {provider.completedJobsCount != null ? (
                  <span className="font-normal text-muted-foreground">
                    · {provider.completedJobsCount} jobs
                  </span>
                ) : null}
              </span>
            ) : provider.completedJobsCount != null ? (
              <span>{provider.completedJobsCount} jobs completed</span>
            ) : null}

            {provider.serviceArea ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {provider.serviceArea}
              </span>
            ) : null}

            {provider.responseTime ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" />
                {provider.responseTime}
              </span>
            ) : null}
          </div>

          {skillChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skillChips.map((s) => (
                <Badge key={s} variant="neutral" className="capitalize">
                  {s.replaceAll('_', ' ')}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {(rate || provider.availableNow || action) && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
          <div className="flex items-center gap-2 text-xs">
            {rate ? (
              <span className="font-semibold tabular-nums text-foreground">
                {rate}
                <span className="ml-1 font-normal text-muted-foreground">
                  excl. materials
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Quoted per job</span>
            )}
            {provider.availableNow ? (
              <Badge variant="success">Available now</Badge>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
    </Link>
  )
}
