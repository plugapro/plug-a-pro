'use client'
// ─── ResolveCaseForm ──────────────────────────────────────────────────────────
// Resolve/reopen a case inline (no dialog - keeps the page server-first).
// Shows reason code select populated from the queue's registry.
// Note textarea appears for all codes; required when noteRequired=true.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'

export interface ReasonCodeOption {
  code: string
  label: string
  requiresNote: boolean
}

export function ResolveCaseForm({
  caseId,
  queueType,
  isResolved,
  reasonCodes,
  resolveAction,
  reopenAction,
  claimAction,
  ownerUserId,
  currentUserId,
}: {
  caseId: string
  queueType: string
  isResolved: boolean
  reasonCodes: ReasonCodeOption[]
  resolveAction: (formData: FormData) => Promise<void>
  reopenAction:  (formData: FormData) => Promise<void>
  claimAction:   (formData: FormData) => Promise<void>
  ownerUserId:   string | null
  currentUserId: string
}) {
  const [selectedCode, setSelectedCode] = useState('')
  const noteRequired = reasonCodes.find((r) => r.code === selectedCode)?.requiresNote ?? false

  if (isResolved) {
    return (
      <form action={reopenAction} className="pt-2">
        <input type="hidden" name="caseId" value={caseId} />
        <Button type="submit" variant="outline" size="sm">
          Reopen case
        </Button>
      </form>
    )
  }

  return (
    <div className="space-y-3">
      {/* Claim / Release */}
      <form action={claimAction}>
        <input type="hidden" name="caseId" value={caseId} />
        {ownerUserId ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Assigned to <strong>{ownerUserId}</strong></span>
            {ownerUserId === currentUserId && (
              <input type="hidden" name="release" value="1" />
            )}
            <Button type="submit" size="sm" variant="ghost">
              {ownerUserId === currentUserId ? 'Release' : 'Claim'}
            </Button>
          </div>
        ) : (
          <Button type="submit" size="sm" variant="outline">
            Claim
          </Button>
        )}
      </form>

      <Separator />

      {/* Resolve form */}
      <form action={resolveAction} className="space-y-3">
        <input type="hidden" name="caseId" value={caseId} />

        <div className="space-y-1.5">
          <Label htmlFor={`rc-${caseId}`} className="text-xs">Reason code</Label>
          <Select
            name="reasonCode"
            value={selectedCode}
            onValueChange={setSelectedCode}
            required
          >
            <SelectTrigger id={`rc-${caseId}`} className="h-8 text-sm">
              <SelectValue placeholder="Select reason…" />
            </SelectTrigger>
            <SelectContent>
              {reasonCodes.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`note-${caseId}`} className="text-xs">
            Note{noteRequired ? ' (required)' : ' (optional)'}
          </Label>
          <Textarea
            id={`note-${caseId}`}
            name="note"
            placeholder="Add context…"
            rows={3}
            required={noteRequired}
            className="text-sm"
          />
        </div>

        <Button
          type="submit"
          size="sm"
          disabled={!selectedCode}
          className="w-full"
        >
          Resolve case
        </Button>
      </form>
    </div>
  )
}
