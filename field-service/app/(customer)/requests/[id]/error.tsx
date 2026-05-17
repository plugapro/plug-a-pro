'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function CustomerRequestDetailError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error('[customer:request-detail]', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-8">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-medium text-destructive">Could not load this request</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || 'Something went wrong while loading your service request.'}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link href="/bookings">View my requests</Link>
          </Button>
          <Button type="button" className="w-full" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
