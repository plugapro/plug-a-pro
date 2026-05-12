'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { issueRefundAction } from '../actions'

interface RefundPaymentButtonProps {
  paymentId: string
  maxAmount: number
  amountLabel: string
  disabled?: boolean
}

export function RefundPaymentButton({ paymentId, maxAmount, amountLabel, disabled }: RefundPaymentButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [refundAmount, setRefundAmount] = React.useState(maxAmount)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setOpen(false)
    const formData = new FormData()
    formData.set('paymentId', paymentId)
    formData.set('amount', String(refundAmount))
    // issueRefundAction redirects on completion — call via startTransition so
    // Next.js handles the navigation after the server action resolves.
    startTransition(async () => {
      await issueRefundAction(formData)
    })
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0.01}
          max={maxAmount}
          step={0.01}
          value={refundAmount}
          onChange={(e) => setRefundAmount(Number(e.target.value))}
          className="h-8 w-24 rounded-lg text-xs"
          disabled={disabled || isPending}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || isPending}
          onClick={() => setOpen(true)}
        >
          Refund
        </Button>
      </div>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Issue refund"
        description={`This issues a refund for R ${refundAmount.toFixed(2)}. Type the full payment amount to confirm.`}
        confirmText={amountLabel}
        confirmLabel="Refund"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
