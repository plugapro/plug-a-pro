'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type QuoteItem = { id: string; amount: number; notes: string | null }

export function QuoteReviewScreen({ requestId, quote }: { requestId: string; quote: QuoteItem }) {
  const router = useRouter()

  async function approve() {
    const res = await fetch(`/api/client/quotes/${quote.id}/approve`, { method: 'POST' })
    if (!res.ok) return toast.error('Could not approve quote')
    const data = await res.json()
    router.push(`/client/jobs/${data.jobId}`)
  }

  async function decline() {
    const res = await fetch(`/api/client/quotes/${quote.id}/decline`, { method: 'POST' })
    if (!res.ok) return toast.error('Could not decline quote')
    router.push(`/client/requests/${requestId}`)
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <h1 className="text-2xl font-bold tracking-tight">Quote review</h1>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="font-mono text-xs text-[var(--ink-mute)]">Total</p>
        <p className="text-2xl font-bold">R{Number(quote.amount).toFixed(2)}</p>
        {quote.notes ? <p className="mt-2 text-sm text-[var(--ink-mute)]">{quote.notes}</p> : null}
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-[rgba(246,246,248,0.92)] px-5 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-xl dark:bg-[rgba(11,11,16,0.92)]">
        <div className="mx-auto flex w-full max-w-md gap-3">
          <button onClick={decline} className="h-12 flex-1 rounded-2xl border border-border bg-card text-sm font-semibold">Decline</button>
          <button onClick={approve} className="h-12 flex-1 rounded-2xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}>Approve</button>
        </div>
      </div>
    </div>
  )
}

