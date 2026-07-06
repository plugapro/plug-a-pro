'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[provider:signup]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Please reply on WhatsApp to try again.
      </p>
      <button className="mt-4 underline" onClick={reset}>
        Retry
      </button>
    </main>
  )
}
