'use client'

import * as React from 'react'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DestructiveConfirmDialog } from '@/components/admin/crud/confirm'
import { notify } from '@/components/admin/ui/ActionToast'
import { deactivateLocationNodeAction } from '../actions'

interface DeactivateLocationButtonProps {
  nodeId: string
  nodeSlug: string
  nodeLabel: string
  isActive: boolean
}

export function DeactivateLocationButton({
  nodeId,
  nodeSlug,
  nodeLabel,
  isActive,
}: DeactivateLocationButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = useTransition()

  if (!isActive) return null

  function handleConfirm() {
    setOpen(false)
    startTransition(async () => {
      try {
        await deactivateLocationNodeAction(nodeId)
        notify.success(`"${nodeLabel}" deactivated`)
        router.refresh()
      } catch (err) {
        notify.error(err, 'Failed to deactivate location')
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending}
        className="text-orange-600 hover:text-orange-700"
        onClick={() => setOpen(true)}
      >
        Deactivate
      </Button>

      <DestructiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Deactivate location"
        description={`This deactivates "${nodeLabel}" and removes it from matching. Type the slug to confirm.`}
        confirmText={nodeSlug}
        confirmLabel="Deactivate"
        pendingLabel="Deactivating…"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
