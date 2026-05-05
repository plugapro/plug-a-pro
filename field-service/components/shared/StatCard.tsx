import * as React from 'react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

interface StatCardProps {
  label: React.ReactNode
  value: React.ReactNode
  /** Optional secondary line — units, change, qualifier ("this month"). */
  hint?: React.ReactNode
  /** Optional inline icon — pass a lucide icon at size-4. */
  icon?: React.ReactNode
  /** Optional accent tone applied to icon chip + value tint. */
  tone?: Tone
  className?: string
}

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'tone-info',
  success: 'tone-success',
  warning: 'tone-warning',
  danger: 'tone-danger',
  brand: 'tone-brand',
}

/**
 * KPI tile used by dashboards — provider home (open jobs, leads, credits,
 * earnings), customer profile (active requests). Compact, scannable,
 * mobile-grid friendly at grid-cols-2.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon ? (
          <span
            aria-hidden
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-lg border',
              TONE_CHIP[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
