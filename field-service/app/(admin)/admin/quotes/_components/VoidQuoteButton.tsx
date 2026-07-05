'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { voidQuoteFromFormAction } from '../actions'

interface VoidQuoteButtonProps {
  quoteId: string
  quoteAmount: string
  disabled?: boolean
}

export function VoidQuoteButton({ quoteId, quoteAmount, disabled }: VoidQuoteButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('quoteId', quoteId)
      formData.set('reason', 'Voided by admin')
      const result = await voidQuoteFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Quote voided')
        router.refresh()
      } else {
        notify.userError((result && 'error' in result ? result.error : undefined) ?? 'Failed to void quote')
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
        title="Void quote"
        description="This permanently voids the quote. Type the quote amount to confirm."
        confirmText={quoteAmount}
        confirmLabel="Void"
        pendingLabel="Voiding…"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
