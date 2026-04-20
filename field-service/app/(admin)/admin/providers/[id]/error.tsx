'use client'

import Link from 'next/link'

export default function ProviderDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-sm">
      <p className="font-semibold text-destructive mb-1">Could not load provider profile</p>
      <p className="text-muted-foreground mb-4">
        An unexpected error occurred while loading this provider detail.
        {error.digest ? (
          <> Reference: <span className="font-mono">{error.digest}</span></>
        ) : null}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          Try again
        </button>
        <Link
          href="/admin/providers"
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          ← Back to providers
        </Link>
      </div>
    </div>
  )
}
