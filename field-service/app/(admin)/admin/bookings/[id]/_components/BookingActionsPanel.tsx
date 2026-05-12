'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { cancelBookingFromFormAction, markPaidFromFormAction } from '../actions'

interface BookingActionsPanelProps {
  bookingId: string
  bookingShortRef: string
  canMarkPaid: boolean
  canCancel: boolean
  crudEnabled: boolean
}

export function BookingActionsPanel({
  bookingId,
  bookingShortRef,
  canMarkPaid,
  canCancel,
  crudEnabled,
}: BookingActionsPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [markPaidOpen, setMarkPaidOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)

  function handleMarkPaid() {
    setMarkPaidOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('bookingId', bookingId)
      const result = await markPaidFromFormAction(formData)
      if (result.ok) {
        notify.success('Payment marked as paid')
        router.refresh()
      } else {
        notify.userError(result.error ?? 'Failed to mark payment as paid')
      }
    })
  }

  function handleCancel() {
    setCancelOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('bookingId', bookingId)
      const result = await cancelBookingFromFormAction(formData)
      if (result.ok) {
        notify.success('Booking cancelled')
        router.refresh()
      } else {
        notify.userError(result.error ?? 'Failed to cancel booking')
      }
    })
  }

  return (
    <>
      {canMarkPaid && (
        <Button
          className="w-full"
          variant="default"
          disabled={!crudEnabled || isPending}
          onClick={() => setMarkPaidOpen(true)}
        >
          Mark as Paid
        </Button>
      )}

      {canCancel && (
        <Button
          className="w-full"
          variant="destructive"
          disabled={!crudEnabled || isPending}
          onClick={() => setCancelOpen(true)}
        >
          Cancel Booking
        </Button>
      )}

      {!canMarkPaid && !canCancel && (
        <p className="text-xs text-muted-foreground text-center">No actions available</p>
      )}

      <DestructiveConfirmDialog
        open={markPaidOpen}
        onOpenChange={setMarkPaidOpen}
        title="Mark payment as paid"
        description="This will record the payment as paid. Type the booking reference to confirm."
        confirmText={bookingShortRef}
        confirmLabel="Mark Paid"
        onConfirm={handleMarkPaid}
        loading={isPending}
      />

      <DestructiveConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel booking"
        description="This permanently cancels the booking. Type the booking reference to confirm."
        confirmText={bookingShortRef}
        confirmLabel="Cancel Booking"
        onConfirm={handleCancel}
        loading={isPending}
      />
    </>
  )
}
