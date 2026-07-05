'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { resolveCaseAction } from '../_actions/case'
import { toast } from 'sonner'

const REASON_CODES = [
  'COVERAGE_GAP',
  'DUPLICATE_REQUEST',
  'CUSTOMER_CANCELLED',
  'FRAUD_SUSPECTED',
  'PROVIDER_UNRESPONSIVE',
  'OUT_OF_SCOPE',
  'RESOLVED_SUCCESSFULLY',
  'OTHER',
]

interface Props {
  caseId: string
  trigger?: React.ReactNode
}

export function ResolveCaseDialog({ caseId, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState('')
  const [outcome, setOutcome] = useState('')
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()

  const noteRequired = reasonCode === 'OTHER'

  function handleResolve() {
    if (!reasonCode || !outcome) {
      toast.error('Outcome and reason code are required')
      return
    }
    if (noteRequired && !note.trim()) {
      toast.error('Note is required when reason is OTHER')
      return
    }
    startTransition(async () => {
      try {
        await resolveCaseAction({ caseId, outcome, reasonCode, note })
        toast.success('Case resolved')
        setOpen(false)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to resolve case')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" variant="default">Resolve</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve case</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="outcome">Outcome summary</Label>
            <Textarea
              id="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="Brief summary of how this was resolved"
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reasonCode">Reason code</Label>
            <Select onValueChange={setReasonCode}>
              <SelectTrigger id="reasonCode">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="note">
              Note{' '}
              {noteRequired ? (
                <span className="text-destructive">*</span>
              ) : (
                '(optional)'
              )}
            </Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                noteRequired ? 'Required for OTHER reason code' : 'Additional context'
              }
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleResolve} loading={isPending} loadingLabel="Resolving case…">
              Resolve case
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
