'use client'

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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

const REVISION_REASONS = [
  'Price is too high for the scope',
  'Need the quote broken down more clearly',
  'Need a different date or timing',
  'Need the provider to inspect first',
  'Need materials or labour adjusted',
  'Other',
] as const

interface Quote {
  id: string
  status: string
  providerName: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  description: string
  estimatedHours: number | null
  validUntil: string | null
  preferredDate: string | null
  expired: boolean
}

export function QuoteApproval({ quote, token }: { quote: Quote; token: string }) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle')
  // Tracks which button is currently in-flight so each can show its own
  // spinner/label without the other looking idle while the request runs.
  const [pendingAction, setPendingAction] = useState<'approve' | 'decline' | null>(null)
  const [result, setResult] = useState<'approved' | 'declined' | null>(null)
  const [scheduledDate, setScheduledDate] = useState<string | null>(
    quote.status === 'APPROVED' ? (quote.preferredDate ?? null) : null
  )
  const [revisionReason, setRevisionReason] = useState<string>('')
  const [revisionNotes, setRevisionNotes] = useState('')
  const [error, setError] = useState('')

  if (quote.status === 'APPROVED' || result === 'approved') {
    const dateStr = scheduledDate
      ? new Date(scheduledDate).toLocaleDateString('en-ZA', {
          weekday: 'long', day: 'numeric', month: 'long',
        })
      : null
    return (
      <div className="tone-success rounded-2xl border p-6 text-center space-y-2">
        <p className="text-2xl">✅</p>
        <p className="font-semibold">Quote Accepted</p>
        {dateStr && (
          <p className="text-sm font-medium">{quote.providerName} is scheduled for {dateStr}.</p>
        )}
        {!dateStr && (
          <p className="text-sm font-medium">
            {quote.providerName} has been notified. Plug A Pro will confirm the service date with you next.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {quote.providerName} has been notified. You&apos;ll receive a confirmation message on WhatsApp.
        </p>
      </div>
    )
  }

  if (quote.status === 'DECLINED' || result === 'declined') {
    return (
      <div className="tone-danger rounded-2xl border p-6 text-center space-y-2">
        <p className="text-2xl">❌</p>
        <p className="font-semibold">Quote Declined</p>
        <p className="text-sm text-muted-foreground">
          We&apos;ve notified the provider. They can revise and resend the quote if the job still makes sense to continue.
        </p>
      </div>
    )
  }

  if (quote.expired || quote.status === 'EXPIRED') {
    return (
      <div className="tone-warning rounded-2xl border p-6 text-center space-y-2">
        <p className="text-2xl">⏱️</p>
        <p className="font-semibold">Quote Expired</p>
        <p className="text-sm text-muted-foreground">
          This quote expired on {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('en-ZA') : 'an earlier date'}.
          Please contact {quote.providerName} to request a new one.
        </p>
      </div>
    )
  }

  async function respond(action: 'approve' | 'decline') {
    if (action === 'decline' && !revisionReason) {
      setError('Select a reason so the provider can revise the quote properly.')
      return
    }

    setStatus('submitting')
    setPendingAction(action)
    setError('')
    try {
      const feedback =
        action === 'decline'
          ? [revisionReason, revisionNotes.trim()].filter(Boolean).join(': ')
          : null
      const res = await fetch(`/api/quotes/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'We could not update this quote right now. Please try again.')
      }
      const data = await res.json().catch(() => ({})) as {
        status?: string
        scheduledDate?: string | null
      }
      if (action === 'approve' && data.scheduledDate) {
        setScheduledDate(data.scheduledDate)
      }
      setResult(action === 'approve' ? 'approved' : 'declined')
      // Reset to idle on success too — otherwise both CTAs stay disabled
      // during the brief window before `result` flips the render to the
      // success view (visible on slow networks / mid re-render).
      setStatus('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatus('idle')
    } finally {
      setPendingAction(null)
    }
  }

  const fmt = (v: number) => `R ${v.toFixed(2)}`

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Labour</span>
          <span>{fmt(quote.labourCost)}</span>
        </div>
        {quote.materialsCost > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Materials</span>
            <span>{fmt(quote.materialsCost)}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>{fmt(quote.totalAmount)}</span>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground font-medium">Scope of work</p>
        <p>{quote.description}</p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="revision-reason">If you need a revision</Label>
          <Select value={revisionReason} onValueChange={setRevisionReason}>
            <SelectTrigger id="revision-reason" className="w-full">
              <SelectValue placeholder="Select what should change" />
            </SelectTrigger>
            <SelectContent>
              {REVISION_REASONS.map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {reason}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="revision-notes">Add detail for the provider</Label>
          <Textarea
            id="revision-notes"
            rows={3}
            placeholder="Optional: explain what should be adjusted before you can accept."
            value={revisionNotes}
            onChange={(event) => setRevisionNotes(event.target.value)}
          />
        </div>
      </div>

      {(quote.estimatedHours || quote.preferredDate || quote.validUntil) && (
        <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-sm">
          {quote.estimatedHours && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated time</span>
              <span>{quote.estimatedHours}h</span>
            </div>
          )}
          {quote.preferredDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Suggested date</span>
              <span>{new Date(quote.preferredDate).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            </div>
          )}
          {quote.validUntil && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valid until</span>
              <span>{new Date(quote.validUntil).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className="flex-1"
          loading={status === 'submitting' && pendingAction === 'decline'}
          loadingLabel="Sending…"
          disabled={status === 'submitting'}
          onClick={() => respond('decline')}
        >
          Request Revision
        </Button>
        <Button
          className="flex-1"
          loading={status === 'submitting' && pendingAction === 'approve'}
          loadingLabel="Processing…"
          disabled={status === 'submitting'}
          onClick={() => respond('approve')}
        >
          Accept Quote
        </Button>
      </div>
    </div>
  )
}
