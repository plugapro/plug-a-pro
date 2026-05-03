import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Lightweight skeleton primitive. Animates a soft pulse on a low-contrast
 * surface to signal "loading" without screaming for attention.
 *
 * Compose into screen-specific shapes via the named variants below.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-muted/70',
        className,
      )}
      {...props}
    />
  )
}

/** Skeleton block for a card-shaped row (job, booking, quote, lead). */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-busy
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <div className="flex items-center justify-between gap-3 pt-1">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/** N stacked card skeletons. */
export function ListSkeleton({
  rows = 3,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

/** A 2-column grid of small KPI tiles (used by dashboards). */
export function StatGridSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-4"
        >
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ))}
    </div>
  )
}
