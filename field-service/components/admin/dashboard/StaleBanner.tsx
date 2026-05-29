import Link from 'next/link'

export function StaleBanner({
  refreshHref,
  message = 'Some data on this page failed to load. Refresh to retry or check the health endpoint.',
}: {
  refreshHref: string
  message?: string
}) {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>⚠ {message}</p>
        <div className="flex items-center gap-3 text-xs font-medium">
          <Link href={refreshHref} className="underline underline-offset-4">
            Refresh
          </Link>
          <Link href="/api/health" className="underline underline-offset-4">
            Health endpoint
          </Link>
        </div>
      </div>
    </div>
  )
}
