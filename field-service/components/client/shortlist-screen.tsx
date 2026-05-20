import Link from 'next/link'
import { ChevronRight, Star } from 'lucide-react'

type ShortlistItem = {
  id: string
  providerId: string
  provider: { name: string | null }
  displayCallOutFee?: number | null
}

export function ShortlistScreen({ requestId, items }: { requestId: string; items: ShortlistItem[] }) {
  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Provider shortlist</h1>
      <p className="mt-1 text-sm text-[var(--ink-mute)]">Compare and pick one provider.</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/client/requests/${requestId}/providers/${item.providerId}`}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]">
              <Star size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{item.provider.name ?? 'Provider'}</span>
              <span className="block text-xs text-[var(--ink-mute)]">
                {item.displayCallOutFee != null ? `Call-out: R${Number(item.displayCallOutFee).toFixed(0)}` : 'Call-out on quote'}
              </span>
            </span>
            <ChevronRight size={16} className="text-[var(--ink-mute)]" />
          </Link>
        ))}
      </div>
    </div>
  )
}

