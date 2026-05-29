import * as React from 'react'
import { cn } from '@/lib/utils'

interface CompletionMeterProps {
  /** 0–100. Value is clamped. */
  value: number
  label?: React.ReactNode
  /** Right-aligned numeric readout - defaults to "{value}% complete". */
  readout?: React.ReactNode
  /** Optional hint copy below the bar - e.g. missing fields summary. */
  hint?: React.ReactNode
  className?: string
}

/**
 * Profile-completeness / onboarding-progress indicator. Used by the
 * provider dashboard, onboarding screens and the customer profile.
 *
 * Tone shifts from danger → warning → primary as completion improves
 * so users see at a glance whether they're far from done. We intentionally
 * tint the *bar*, not the surrounding chrome, to keep the rest of the
 * card calm.
 */
export function CompletionMeter({
  value,
  label = 'Profile completeness',
  readout,
  hint,
  className,
}: CompletionMeterProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  const tone =
    clamped < 40
      ? 'bg-[var(--tone-danger-fg)]'
      : clamped < 80
        ? 'bg-[var(--tone-warning-fg)]'
        : 'bg-primary'

  return (
    <div
      className={cn('space-y-2', className)}
      role="group"
      aria-label={typeof label === 'string' ? label : undefined}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-muted-foreground">
          {readout ?? `${clamped}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full transition-[width]', tone)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
