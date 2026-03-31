'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

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
  const [result, setResult] = useState<'approved' | 'declined' | null>(null)
  const [scheduledDate, setScheduledDate] = useState<string | null>(
    quote.status === 'APPROVED' ? (quote.preferredDate ?? null) : null
  )
  const [error, setError] = useState('')

  if (quote.status === 'APPROVED' || result === 'approved') {
    const dateStr = scheduledDate
      ? new Date(scheduledDate).toLocaleDateString('en-ZA', {
          weekday: 'long', day: 'numeric', month: 'long',
        })
      : null
    return (
      <div className="rounded-lg border bg-green-50 dark:bg-green-950 p-6 text-center space-y-2">
        <p className="text-2xl">✅</p>
        <p className="font-semibold">Quote Accepted</p>
        {dateStr && (
          <p className="text-sm font-medium">{quote.providerName} is scheduled for {dateStr}.</p>
        )}
        <p className="text-sm text-muted-foreground">
          {quote.providerName} has been notified. You&apos;ll receive a confirmation message on WhatsApp.
        </p>
      </div>
    )
  }

  if (quote.status === 'DECLINED' || result === 'declined') {
    return (
      <div className="rounded-lg border p-6 text-center space-y-2">
        <p className="text-2xl">❌</p>
        <p className="font-semibold">Quote Declined</p>
        <p className="text-sm text-muted-foreground">We&apos;ve notified the provider. We&apos;ll find you another option.</p>
      </div>
    )
  }

  if (quote.expired || quote.status === 'EXPIRED') {
    return (
      <div className="rounded-lg border p-6 text-center space-y-2">
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
    setStatus('submitting')
    setError('')
    try {
      const res = await fetch(`/api/quotes/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (data.error === 'ALREADY_ACTIONED') {
          setResult(action === 'approve' ? 'approved' : 'declined')
          return
        }
        if (data.error === 'EXPIRED') {
          throw new Error('This quote has expired. Please contact the provider to request a new one.')
        }
        throw new Error(data.error ?? 'Something went wrong')
      }
      const data = await res.json().catch(() => ({})) as { status?: string; scheduledDate?: string | null }
      if (action === 'approve' && data.scheduledDate) {
        setScheduledDate(data.scheduledDate)
      }
      setResult(action === 'approve' ? 'approved' : 'declined')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatus('idle')
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
          disabled={status === 'submitting'}
          onClick={() => respond('decline')}
        >
          Decline
        </Button>
        <Button
          className="flex-1"
          disabled={status === 'submitting'}
          onClick={() => respond('approve')}
        >
          {status === 'submitting' ? 'Processing…' : 'Accept Quote'}
        </Button>
      </div>
    </div>
  )
}
