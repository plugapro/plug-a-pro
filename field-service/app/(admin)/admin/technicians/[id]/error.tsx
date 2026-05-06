'use client'

import * as React from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'

export default function TechnicianDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    console.error('[admin error boundary] technician detail', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-sm">
      <p className="font-semibold text-destructive mb-1">Could not load provider profile</p>
      <p className="text-muted-foreground mb-2">
        An unexpected error occurred while loading this provider detail.
      </p>
      {error.digest && (
        <p className="font-mono text-xs mb-4">
          Reference: <span className="rounded bg-background px-1 border">{error.digest}</span>
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          Try again
        </button>
        <Link
          href="/admin/technicians"
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          ← Back to providers
        </Link>
      </div>
    </div>
  )
}
