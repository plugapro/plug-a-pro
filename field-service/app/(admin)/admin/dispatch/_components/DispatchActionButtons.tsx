'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud'
import {
  overrideAssignmentAction,
  redispatchFromFormAction,
  escalateToSupplyFromFormAction,
} from '../actions'

// ─── Redispatch + Escalate buttons ────────────────────────────────────────────

interface DispatchControlButtonsProps {
  jobRequestId: string
  disabled?: boolean
}

export function DispatchControlButtons({ jobRequestId, disabled }: DispatchControlButtonsProps) {
  const [isPending, startTransition] = useTransition()
  const [redispatchOpen, setRedispatchOpen] = React.useState(false)
  const [escalateOpen, setEscalateOpen] = React.useState(false)

  const confirmText = jobRequestId.slice(-6)

  const handleRedispatchConfirm = () => {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('jobRequestId', jobRequestId)
      await redispatchFromFormAction(fd)
    })
  }

  const handleEscalateConfirm = () => {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('jobRequestId', jobRequestId)
      await escalateToSupplyFromFormAction(fd)
    })
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || isPending}
        onClick={() => setRedispatchOpen(true)}
      >
        Re-dispatch (retry leads)
      </Button>

      <Button
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-destructive/5"
        disabled={disabled || isPending}
        onClick={() => setEscalateOpen(true)}
      >
        Escalate to Supply
      </Button>

      <DestructiveConfirmDialog
        open={redispatchOpen}
        onOpenChange={setRedispatchOpen}
        title="Re-trigger matching?"
        description="Sends the request back through automated matching. The current dispatch case will be updated."
        confirmLabel="Re-trigger"
        confirmText={confirmText}
        onConfirm={handleRedispatchConfirm}
        loading={isPending}
      />

      <DestructiveConfirmDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        title="Escalate to supply?"
        description="Records an escalation on the dispatch case. Operations will need to manually find coverage."
        confirmLabel="Escalate"
        confirmText={confirmText}
        onConfirm={handleEscalateConfirm}
        loading={isPending}
      />
    </>
  )
}

// ─── Force Assign (override) button per candidate ────────────────────────────

interface ForceAssignButtonProps {
  jobRequestId: string
  providerId: string
  reasonCode?: string
  disabled?: boolean
}

export function ForceAssignButton({
  jobRequestId,
  providerId,
  reasonCode = 'FORCE_ASSIGNED_COVERAGE_EXTENSION',
  disabled,
}: ForceAssignButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = React.useState(false)

  const confirmText = jobRequestId.slice(-6)

  const handleConfirm = () => {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('jobRequestId', jobRequestId)
      fd.set('providerId', providerId)
      fd.set('reasonCode', reasonCode)
      await overrideAssignmentAction(fd)
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || isPending}
        onClick={() => setOpen(true)}
      >
        {isPending ? 'Working…' : 'Force assign'}
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Override assignment?"
        description="This forces the provider assignment. It cannot be undone automatically."
        confirmLabel="Force assign"
        confirmText={confirmText}
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
