'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/currency'

interface Props {
  token: string
  description: string
  amount: number
  customerName: string
  serviceName: string
  onAction: (formData: FormData) => Promise<void>
}

export function ApprovalCard({
  description,
  amount,
  customerName,
  serviceName,
  onAction,
}: Props) {
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null)
  const [done, setDone] = useState<'approved' | 'declined' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (done) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="text-3xl mb-3">{done === 'approved' ? '✓' : '✗'}</p>
        <p className="font-semibold">
          {done === 'approved' ? 'Work Approved' : 'Work Declined'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Your technician has been notified.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="font-semibold mb-1">Additional Work Needed</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Hi {customerName}, your technician needs approval before continuing.
      </p>

      <div className="rounded-lg bg-muted p-4 mb-5 space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Service</p>
          <p className="text-sm font-medium">{serviceName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Work required</p>
          <p className="text-sm">{description}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Additional cost</p>
          <p className="text-xl font-bold">{formatCurrency(amount)}</p>
        </div>
      </div>

      <form
        action={async (fd) => {
          const action = fd.get('action') as 'approve' | 'decline'
          setError(null)
          setPending(action)
          try {
            await onAction(fd)
            setDone(action === 'approve' ? 'approved' : 'declined')
          } catch {
            setError('We could not save your decision right now. Please try again.')
          } finally {
            setPending(null)
          }
        }}
        className="flex gap-3"
      >
        <button
          type="submit"
          name="action"
          value="approve"
          disabled={!!pending}
          className="flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="submit"
          name="action"
          value="decline"
          disabled={!!pending}
          className="flex-1 rounded-lg border px-4 py-3 text-sm font-semibold disabled:opacity-50"
        >
          {pending === 'decline' ? 'Declining…' : 'Decline'}
        </button>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  )
}
