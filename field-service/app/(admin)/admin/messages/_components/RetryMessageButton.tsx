'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { retryMessageFromFormAction } from '../actions'

interface RetryMessageButtonProps {
  messageId: string
  disabled?: boolean
}

export function RetryMessageButton({ messageId, disabled }: RetryMessageButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  const shortId = messageId.slice(-6).toUpperCase()

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('messageId', messageId)
      const result = await retryMessageFromFormAction(formData)
      if (result && 'ok' in result && result.ok) {
        notify.success('Message queued for retry')
        router.refresh()
      } else {
        notify.userError(
          (result && 'error' in result ? result.error : undefined) ?? 'Failed to retry message',
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
        Retry
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Retry failed message"
        description={`This re-queues the message for delivery. Type the message ID to confirm.`}
        confirmText={shortId}
        confirmLabel="Retry"
        pendingLabel="Retrying…"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
