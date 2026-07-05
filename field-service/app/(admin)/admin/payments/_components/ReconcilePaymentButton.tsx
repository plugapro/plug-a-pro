'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { reconcilePaymentFromFormAction } from '../actions'

interface ReconcilePaymentButtonProps {
  paymentId: string
  amountLabel: string
  disabled?: boolean
}

export function ReconcilePaymentButton({ paymentId, amountLabel, disabled }: ReconcilePaymentButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('paymentId', paymentId)
      formData.set('reason', 'Reconciled offline by admin')
      const result = await reconcilePaymentFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Payment reconciled as paid')
        router.refresh()
      } else {
        notify.userError(
          (result && 'error' in result ? result.error : undefined) ?? 'Failed to reconcile payment',
        )
      }
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
        Reconcile offline
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reconcile payment offline"
        description="This marks the payment as PAID via offline collection. Type the payment amount to confirm."
        confirmText={amountLabel}
        confirmLabel="Reconcile"
        pendingLabel="Reconciling…"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
