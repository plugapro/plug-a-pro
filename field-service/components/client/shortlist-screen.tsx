import Link from 'next/link'
import { ChevronRight, Star } from 'lucide-react'

type ShortlistItem = {
  id: string
  providerId: string
  provider: {
    name: string | null
    verified?: boolean
    averageRating?: number | null
    completedJobsCount?: number | null
    experience?: string | null
  }
  callOutFee?: number | null
  estimatedArrivalAt?: Date | null | string
  negotiable?: boolean | null
}

export function ShortlistScreen({ requestId, items }: { requestId: string; items: ShortlistItem[] }) {
  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Provider shortlist</h1>
      <p className="mt-1 text-sm text-[var(--ink-mute)]">Compare providers before choosing.</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/client/requests/${requestId}/providers/${item.providerId}`}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--tone-brand-bg)] text-[var(--tone-brand-fg)]">
              <Star size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {item.provider.name ?? 'Provider'}
                {item.provider.verified ? ' · Verified' : ''}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--ink-mute)]">
                {item.provider.averageRating != null ? `${item.provider.averageRating.toFixed(1)}★` : 'New profile'}
                {typeof item.provider.completedJobsCount === 'number' ? ` · ${item.provider.completedJobsCount} jobs` : ''}
                {item.provider.experience ? ` · ${item.provider.experience}` : ''}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--ink-mute)]">
                {item.callOutFee != null ? `Call-out: R${Number(item.callOutFee).toFixed(0)}` : 'Call-out on quote'}
                {item.negotiable ? ' · Negotiable' : ''}
              </span>
              {item.estimatedArrivalAt ? (
                <span className="mt-0.5 block text-xs text-[var(--ink-mute)]">
                  ETA: {new Date(item.estimatedArrivalAt).toLocaleString('en-ZA')}
                </span>
              ) : null}
            </span>
            <ChevronRight size={16} className="text-[var(--ink-mute)]" />
          </Link>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-xs text-[var(--ink-mute)]">
        Need more options or help? You can adjust your request from the request status page.
      </div>
    </div>
  )
}
