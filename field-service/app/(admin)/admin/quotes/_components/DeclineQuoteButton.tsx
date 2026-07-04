'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { declineQuoteFromFormAction } from '../actions'

interface DeclineQuoteButtonProps {
  quoteId: string
  quoteAmount: string
  disabled?: boolean
}

export function DeclineQuoteButton({ quoteId, quoteAmount, disabled }: DeclineQuoteButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('quoteId', quoteId)
      formData.set('reason', 'Declined by admin')
      const result = await declineQuoteFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Quote declined')
        router.refresh()
      } else {
        notify.userError((result && 'error' in result ? result.error : undefined) ?? 'Failed to decline quote')
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
        Decline
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Decline quote"
        description="This declines the quote on behalf of the customer. Type the quote amount to confirm."
        confirmText={quoteAmount}
        confirmLabel="Decline"
        pendingLabel="Declining…"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
