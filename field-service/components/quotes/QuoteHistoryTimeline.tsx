import type { QuoteStatus } from '@prisma/client'
import Link from 'next/link'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'

export interface QuoteHistoryItem {
  id: string
  amount: number
  labourCost: number
  materialsCost: number
  description: string
  status: QuoteStatus
  estimatedHours: number | null
  preferredDate: Date | null
  validUntil: Date | null
  createdAt: Date
  approvedAt?: Date | null
  declinedAt?: Date | null
  notes?: string | null
  approvalToken?: string
}

export function QuoteHistoryTimeline({
  quotes,
  audience,
}: {
  quotes: QuoteHistoryItem[]
  audience: 'customer' | 'provider'
}) {
  if (quotes.length === 0) return null

  const ordered = [...quotes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const latestId = ordered[ordered.length - 1]?.id

  return (
    <div className="space-y-3">
      {ordered.map((quote, index) => {
        const versionLabel = index === 0 ? 'Initial quote' : `Revision ${index}`
        const isLatest = quote.id === latestId
        const showReviewLink =
          audience === 'customer' &&
          isLatest &&
          quote.status === 'PENDING' &&
          quote.approvalToken

        return (
          <div
            key={quote.id}
            className={`rounded-xl border px-4 py-4 text-sm ${isLatest ? 'border-primary/40 bg-primary/5' : 'bg-card'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{versionLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Submitted {quote.createdAt.toLocaleDateString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <StatusBadge status={quote.status} type="quote" />
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold">R {quote.amount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Labour</span>
                <span>R {quote.labourCost.toFixed(2)}</span>
              </div>
              {quote.materialsCost > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Materials</span>
                  <span>R {quote.materialsCost.toFixed(2)}</span>
                </div>
              )}
              {quote.estimatedHours && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Estimated time</span>
                  <span>{quote.estimatedHours}h</span>
                </div>
              )}
              {quote.preferredDate && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Proposed date</span>
                  <span>
                    {quote.preferredDate.toLocaleDateString('en-ZA', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </div>
              )}
              {quote.validUntil && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Valid until</span>
                  <span>
                    {quote.validUntil.toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scope of work
              </p>
              <p className="text-sm text-muted-foreground">{quote.description}</p>
            </div>

            {quote.notes && (
              <div className="mt-3 rounded-lg border bg-muted/40 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Customer feedback
                </p>
                <p className="mt-1 text-sm">{quote.notes}</p>
              </div>
            )}

            {showReviewLink && (
              <div className="mt-3">
                <Button asChild className="w-full">
                  <Link href={`/quotes/${quote.approvalToken}`}>Review current quote</Link>
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
