import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Optional retry control — typically a Button that re-runs the query. */
  retry?: React.ReactNode
  /** Optional support link — e.g. "Contact support" WhatsAppButton. */
  support?: React.ReactNode
  className?: string
}

/**
 * Use whenever a server fetch or action fails on a screen the user is
 * actively looking at. Always surfaces a retry path; never a dead end.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this view. Please try again — your data is safe.',
  retry,
  support,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border tone-danger px-6 py-10 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]"
      >
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm opacity-90">{description}</p>
        ) : null}
      </div>
      {(retry || support) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {retry}
          {support}
        </div>
      )}
    </div>
  )
}
