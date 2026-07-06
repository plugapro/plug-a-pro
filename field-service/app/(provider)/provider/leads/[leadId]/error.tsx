'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/button'

export default function LeadDetailError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error('[provider:lead-detail]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-8">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-medium text-destructive">Lead could not be loaded</p>
        <h1 className="mt-2 text-xl font-semibold">Try again</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || 'Something went wrong while loading this lead.'}
        </p>
        <Button type="button" className="mt-4 w-full" onClick={reset}>
          Reload Lead
        </Button>
      </div>
    </div>
  )
}
