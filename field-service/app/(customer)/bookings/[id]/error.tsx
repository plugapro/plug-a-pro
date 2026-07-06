'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import * as Sentry from '@sentry/nextjs'
import { Button } from '@/components/ui/button'

export default function CustomerBookingDetailError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error('[customer:booking-detail]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-8">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-medium text-destructive">Could not load this booking</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || 'Something went wrong while loading your booking.'}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link href="/bookings">View my bookings</Link>
          </Button>
          <Button type="button" className="w-full" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
