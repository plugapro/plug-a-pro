'use client'

// ─── Extra work request form ───────────────────────────────────────────────────
// Submits description + amount to /api/technician/jobs/[id]/extras.
// On success shows a confirmation message and refreshes the page data.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  jobId: string
  onSubmitted: () => void
}

export function ExtraWorkForm({ jobId, onSubmitted }: Props) {
  const router = useRouter()
  const [isRefreshPending, startTransition] = useTransition()
  // Tracks the actual fetch — previously the button only disabled during
  // router.refresh(), so a user could re-submit during the in-flight POST.
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isPending = isSubmitting || isRefreshPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    setError(null)

    const amountRand = parseFloat(amount)
    if (!description.trim()) {
      setError('Please describe the extra work.')
      return
    }
    if (isNaN(amountRand) || amountRand <= 0) {
      setError('Please enter a valid amount.')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/technician/jobs/${jobId}/extras`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), amountRand }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to submit. Please try again.')
        return
      }

      setSubmitted(true)
      onSubmitted()
      startTransition(() => router.refresh())
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-center text-muted-foreground">
          Sent for approval
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ew-description" className="text-xs text-muted-foreground font-medium">
              Description
            </Label>
            <Textarea
              id="ew-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the additional work required…"
              rows={3}
              required
              disabled={isPending}
              className="resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ew-amount" className="text-xs text-muted-foreground font-medium">
              Amount
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-medium">R</span>
              <Input
                id="ew-amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                required
                disabled={isPending}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full"
            size="lg"
          >
            {isPending ? 'Submitting…' : 'Request approval'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
