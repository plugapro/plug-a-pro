'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[admin]', error)
  }, [error])

  const isDbError =
    error.message?.includes('Tenant or user not found') ||
    error.message?.includes('FATAL') ||
    error.message?.includes('connect ECONNREFUSED') ||
    error.message?.includes('Can\'t reach database')

  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center gap-6">
      <div className="space-y-2 max-w-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-destructive">
          {isDbError ? 'Database unavailable' : 'Page error'}
        </p>
        <h1 className="text-xl font-semibold">
          {isDbError ? 'Could not load admin data' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isDbError
            ? 'The database is not responding. Check that the Supabase project is active and DATABASE_URL is current, then retry.'
            : 'An unexpected error occurred on this page.'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">Error ID: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-3">
        <Button onClick={reset} variant="outline" size="sm">
          Retry
        </Button>
        <Button asChild size="sm">
          <Link href="/admin">Operations</Link>
        </Button>
      </div>
    </div>
  )
}
