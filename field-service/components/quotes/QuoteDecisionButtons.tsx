'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { approveQuoteAction, declineQuoteAction } from '@/app/(customer)/requests/[id]/actions'

interface QuoteDecisionButtonsProps {
  quoteId: string
  requestId: string
}

export function QuoteDecisionButtons({ quoteId, requestId }: QuoteDecisionButtonsProps) {
  const [isPending, startTransition] = useTransition()

  function handleApprove() {
    startTransition(async () => {
      await approveQuoteAction(quoteId, requestId)
    })
  }

  function handleDecline() {
    startTransition(async () => {
      await declineQuoteAction(quoteId, requestId)
    })
  }

  return (
    <div className="mt-3 flex gap-2">
      <Button
        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
        disabled={isPending}
        onClick={handleApprove}
        type="button"
      >
        {isPending ? 'Saving…' : 'Approve'}
      </Button>
      <Button
        variant="outline"
        className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
        disabled={isPending}
        onClick={handleDecline}
        type="button"
      >
        Decline
      </Button>
    </div>
  )
}
