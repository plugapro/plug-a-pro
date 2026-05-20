'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { voidInvoiceFromFormAction } from '../actions'

interface VoidInvoiceButtonProps {
  invoiceId: string
  invoiceNumber: string
  disabled?: boolean
}

export function VoidInvoiceButton({ invoiceId, invoiceNumber, disabled }: VoidInvoiceButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('invoiceId', invoiceId)
      // Static reason - intent is captured by the type-to-confirm dialog (invoice number).
      formData.set('reason', 'Voided by admin')
      const result = await voidInvoiceFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Invoice voided')
        router.refresh()
      } else {
        notify.userError(
          (result && 'error' in result ? result.error : undefined) ?? 'Failed to void invoice',
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
        Void
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Void invoice"
        description="This clears the invoice PDF and marks the invoice as void. Type the invoice number to confirm."
        confirmText={invoiceNumber}
        confirmLabel="Void"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
