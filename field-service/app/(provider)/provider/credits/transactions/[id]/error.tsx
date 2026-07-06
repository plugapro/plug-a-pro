'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AuthShell } from '@/components/shared/auth-shell'
import { Button } from '@/components/ui/button'

export default function TransactionDetailError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    console.error('[provider:credit-transaction-detail]', error)
    Sentry.captureException(error)
  }, [error])

  return (
    <AuthShell
      eyebrow="Credit activity"
      title="Could not load transaction"
      subtitle="This transaction could not be loaded right now."
      backHref="/provider/credits"
      dense
    >
      <div className="mx-auto flex w-full max-w-[390px] flex-col gap-4 pb-4">
        <div className="rounded-[20px] bg-card p-5 text-center shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="text-[13.5px] text-[var(--ink-mute)]">
            The transaction details could not be loaded. Tap below to try again or go back to your credits screen.
          </p>
        </div>
        <Button type="button" size="lg" onClick={reset}>
          Try again
        </Button>
      </div>
    </AuthShell>
  )
}
