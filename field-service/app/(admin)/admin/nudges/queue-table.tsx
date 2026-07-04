'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

import {
  exportNudgeQueueCsvAction,
  markNudgeBatchSentAction,
  previewNudgeAction,
} from './actions'

type CandidateRow = {
  providerId: string
  name: string | null
  phone: string | null
  tier: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'PENDING_R1'
  skills: string[]
  missingItems: string[]
  missingItemsLabel: string
  renderedMessage: string
  lastNudgedAt: string | null
}

type Filter = {
  suburbSlug: string | null
  categorySlug: string | null
  tier: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'PENDING_R1' | null
}

export function NudgeQueueTable({
  candidates,
  filter,
}: {
  candidates: CandidateRow[]
  filter: Filter
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)
  const [markSentOpen, setMarkSentOpen] = useState(false)
  const [confirmPhrase, setConfirmPhrase] = useState('')
  const [batchNote, setBatchNote] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedCount = selected.size
  const expectedConfirmPhrase = `mark-sent-${selectedCount}`

  function toggleSelected(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === candidates.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(candidates.map((c) => c.providerId)))
    }
  }

  async function handlePreview(providerId: string, fallbackMessage: string) {
    setPreviewMessage(fallbackMessage)
    startTransition(async () => {
      const result = await previewNudgeAction({ providerId })
      if (result.ok && result.data.renderedMessage) {
        setPreviewMessage(result.data.renderedMessage)
      }
    })
  }

  async function handleExport() {
    setErrorMessage(null)
    startTransition(async () => {
      const result = await exportNudgeQueueCsvAction({
        suburbSlug: filter.suburbSlug,
        categorySlug: filter.categorySlug,
        tier: filter.tier,
      })
      if (!result.ok) {
        setErrorMessage('Export failed')
        return
      }
      const blob = new Blob([result.data.csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `nudges-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    })
  }

  async function handleMarkSent() {
    setErrorMessage(null)
    startTransition(async () => {
      const result = await markNudgeBatchSentAction({
        providerIds: Array.from(selected),
        batchNote: batchNote.trim() ? batchNote.trim() : null,
        confirmPhrase,
      })
      if (!result.ok) {
        setErrorMessage(
          result.error === 'confirm-phrase-mismatch'
            ? `Confirm phrase mismatch (expected "${expectedConfirmPhrase}")`
            : result.error === 'empty-batch'
              ? 'Select at least one row first'
              : result.error === 'batch-oversized'
                ? `Batch too large (max ${result.cap})`
                : 'Mark sent failed',
        )
        return
      }
      setSelected(new Set())
      setMarkSentOpen(false)
      setConfirmPhrase('')
      setBatchNote('')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleExport} loading={isPending} loadingLabel="Exporting…" variant="outline">
          Export CSV
        </Button>
        <Button
          onClick={() => setMarkSentOpen(true)}
          disabled={isPending || selectedCount === 0}
        >
          Mark {selectedCount} as sent
        </Button>
      </div>

      {errorMessage && (
        <p className="text-sm text-[var(--tone-danger-fg)]">{errorMessage}</p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selectedCount > 0 && selectedCount === candidates.length}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead>Skills</TableHead>
            <TableHead>Missing</TableHead>
            <TableHead>Last nudge</TableHead>
            <TableHead className="text-right">Preview</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No nudge candidates for the current filter.
              </TableCell>
            </TableRow>
          )}
          {candidates.map((c) => (
            <TableRow key={c.providerId}>
              <TableCell>
                <Checkbox
                  checked={selected.has(c.providerId)}
                  onCheckedChange={() => toggleSelected(c.providerId)}
                  aria-label={`Select ${c.name ?? c.providerId}`}
                />
              </TableCell>
              <TableCell className="font-medium">{c.name ?? c.providerId}</TableCell>
              <TableCell>
                <Badge variant="outline">{c.tier}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.skills.join(', ')}
              </TableCell>
              <TableCell className="text-sm">{c.missingItemsLabel}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.lastNudgedAt ? new Date(c.lastNudgedAt).toLocaleDateString('en-ZA') : 'never'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handlePreview(c.providerId, c.renderedMessage)}
                >
                  Preview
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={previewMessage !== null} onOpenChange={(open) => !open && setPreviewMessage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nudge preview</DialogTitle>
            <DialogDescription>What the provider will see when ops sends this nudge.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 text-sm">
            {previewMessage}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={markSentOpen} onOpenChange={setMarkSentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {selectedCount} nudge{selectedCount === 1 ? '' : 's'} as sent</DialogTitle>
            <DialogDescription>
              Audit-only. Records that ops has sent these nudges externally; no message is sent from the app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="batch-note">Batch note (optional)</Label>
              <Textarea
                id="batch-note"
                value={batchNote}
                onChange={(e) => setBatchNote(e.target.value)}
                placeholder="e.g. Sent via WhatsApp Business at 10:30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-phrase">
                Type <code className="rounded bg-muted px-1">{expectedConfirmPhrase}</code> to confirm
              </Label>
              <Input
                id="confirm-phrase"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                placeholder={expectedConfirmPhrase}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMarkSentOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMarkSent}
              loading={isPending}
              loadingLabel="Marking…"
              disabled={confirmPhrase !== expectedConfirmPhrase}
            >
              Mark sent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
