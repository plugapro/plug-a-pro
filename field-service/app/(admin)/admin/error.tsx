'use client'

// Admin-wide error boundary. Catches render/data errors in any /admin/** route
// and renders a graceful fallback instead of a white screen.
// Next.js App Router picks this up automatically when a server or client
// component throws anywhere under /admin.

import * as React from 'react'
import Link from 'next/link'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AdminError({ error, reset }: Props) {
  React.useEffect(() => {
    // Forward to your observability pipeline here (e.g. Sentry.captureException(error))
    console.error('[admin error boundary]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-xl p-8">
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-sm">
        <p className="font-semibold text-destructive mb-1">Something went wrong on this page</p>
        <p className="text-muted-foreground mb-2">
          The rest of the admin is still working — you can navigate away and retry later.
        </p>
        {error.digest && (
          <p className="font-mono text-xs mb-1">
            Reference: <span className="rounded bg-background px-1 border">{error.digest}</span>
          </p>
        )}
        <p className="font-mono text-xs text-muted-foreground mb-4 break-all">
          {error.name}: {error.message}
        </p>
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
          <Link
            href="/admin"
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
