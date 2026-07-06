'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AuthShell } from '@/components/shared/auth-shell'
import { Button } from '@/components/ui/button'

export default function CreditHistoryError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error('[provider:credit-history]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <AuthShell
      eyebrow="Credit history"
      title="Could not load history"
      subtitle="Something went wrong loading your credit transactions."
      backHref="/provider/credits"
      dense
    >
      <div className="mx-auto flex w-full max-w-[390px] flex-col gap-4 pb-4">
        <div className="rounded-[20px] bg-card p-5 text-center shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="text-[13.5px] text-[var(--ink-mute)]">
            Your credit history could not be loaded right now. Tap below to try again.
          </p>
        </div>
        <Button type="button" size="lg" onClick={reset}>
          Try again
        </Button>
      </div>
    </AuthShell>
  )
}
