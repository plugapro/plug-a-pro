'use client'

import * as React from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'

interface AdminErrorPanelProps {
  error: Error & { digest?: string }
  reset: () => void
  title?: string
  backHref?: string
  backLabel?: string
}

export function AdminErrorPanel({
  error,
  reset,
  title = 'Something went wrong on this page',
  backHref,
  backLabel = 'Go back',
}: AdminErrorPanelProps) {
  React.useEffect(() => {
    console.error('[admin error]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="mx-auto max-w-xl p-8">
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-sm">
        <p className="font-semibold text-destructive mb-1">{title}</p>
        <p className="text-muted-foreground mb-4">
          The rest of the admin is still working — you can navigate away and retry later.
        </p>
        {error.digest && (
          <p className="font-mono text-xs mb-4">
            Reference:{' '}
            <span className="rounded bg-background px-1 border">{error.digest}</span>
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
          {backHref && (
            <Link
              href={backHref}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              {backLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
