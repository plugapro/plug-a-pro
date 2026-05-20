'use client'

import * as React from 'react'
import type { DisputeStatus } from '@prisma/client'
import { DISPUTE_RESOLUTION_OPTIONS } from '@/lib/admin/dispute-resolution'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SubmitButton } from '@/components/admin/ui'

type ResolveFormProps = {
  disputeId: string
  action: (formData: FormData) => Promise<void>
  defaultNotes?: string | null
  disabled?: boolean
}

export function ResolveForm({
  disputeId,
  action,
  defaultNotes,
  disabled = false,
}: ResolveFormProps) {
  const [selectedStatus, setSelectedStatus] = React.useState<DisputeStatus | ''>('')

  return (
    <form action={action} className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="status" value={selectedStatus} />

      <div className="space-y-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Resolution outcome
        </p>
        <div className="flex flex-wrap gap-2">
          {DISPUTE_RESOLUTION_OPTIONS.map((option) => (
            <Button
              key={option.status}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className={cn(
                selectedStatus === option.status && 'border-primary bg-primary/10 text-primary',
              )}
              onClick={() => setSelectedStatus(option.status)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <Textarea
        name="resolution"
        defaultValue={defaultNotes ?? ''}
        placeholder="Add internal resolution notes for this case."
        className="min-h-24"
        disabled={disabled}
      />

      <SubmitButton disabled={disabled || !selectedStatus}>
        Resolve dispute
      </SubmitButton>
    </form>
  )
}
