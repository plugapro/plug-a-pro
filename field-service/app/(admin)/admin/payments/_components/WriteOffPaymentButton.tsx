'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { writeOffPaymentFromFormAction } from '../actions'

interface WriteOffPaymentButtonProps {
  paymentId: string
  amountLabel: string
  disabled?: boolean
}

export function WriteOffPaymentButton({ paymentId, amountLabel, disabled }: WriteOffPaymentButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('paymentId', paymentId)
      formData.set('reason', 'Written off by admin')
      const result = await writeOffPaymentFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Payment written off')
        router.refresh()
      } else {
        notify.userError(
          (result && 'error' in result ? result.error : undefined) ?? 'Failed to write off payment',
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
        Write off
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Write off payment"
        description="This marks the payment as FAILED and records the write-off. Type the payment amount to confirm."
        confirmText={amountLabel}
        confirmLabel="Write off"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
