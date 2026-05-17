'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function ProviderGroupError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error('[provider]', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-8">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-medium text-destructive">Something went wrong</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred on the provider portal.'}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link href="/provider">Go to home</Link>
          </Button>
          <Button type="button" className="w-full" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
