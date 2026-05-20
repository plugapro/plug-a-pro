'use client'

// ─── Job status transition controls ──────────────────────────────────────────
// Calls POST /api/technician/jobs/[id]/status to advance the job state machine.
// Exported as JobStatusControls for use in the job detail page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { JobStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { getProviderActionClientErrorMessage } from '@/lib/provider-action-errors'

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'

const TRANSITIONS: Record<JobStatus, { label: string; next: JobStatus; variant: ButtonVariant }[]> = {
  SCHEDULED:                        [{ label: "I'm on my way",       next: 'EN_ROUTE',                        variant: 'default' }],
  EN_ROUTE:                         [{ label: "I've arrived",         next: 'ARRIVED',                         variant: 'default' }],
  ARRIVED:                          [{ label: 'Start job',             next: 'STARTED',                         variant: 'default' }],
  STARTED: [
    { label: 'Mark complete',        next: 'PENDING_COMPLETION_CONFIRMATION', variant: 'default' },
    { label: 'Pause',                next: 'PAUSED',                          variant: 'outline' },
  ],
  PAUSED:                           [{ label: 'Resume',               next: 'STARTED',                         variant: 'default' }],
  AWAITING_APPROVAL:                [],
  PENDING_COMPLETION_CONFIRMATION:  [],
  COMPLETED:                        [],
  CANCELLED:                        [],
  FAILED:                           [],
  CALLBACK_REQUIRED:                [],
}

interface Props {
  jobId: string
  currentStatus: JobStatus
}

export function JobStatusControls({ jobId, currentStatus }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const actions = TRANSITIONS[currentStatus] ?? []
  if (actions.length === 0) return null

  async function transition(toStatus: JobStatus) {
    setError(null)
    try {
      const res = await fetch(`/api/technician/jobs/${jobId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(
          getProviderActionClientErrorMessage({
            action: 'status',
            status: res.status,
            error: data.error ?? null,
          }),
        )
        return
      }

      startTransition(() => router.refresh())
    } catch {
      setError(
        getProviderActionClientErrorMessage({
          action: 'status',
        }),
      )
    }
  }

  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <Button
          key={action.next}
          variant={action.variant}
          size="lg"
          disabled={isPending}
          onClick={() => transition(action.next)}
          className="w-full"
        >
          {isPending ? 'Updating…' : action.label}
        </Button>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// Legacy export - kept for backwards compatibility
export { JobStatusControls as StatusControls }
