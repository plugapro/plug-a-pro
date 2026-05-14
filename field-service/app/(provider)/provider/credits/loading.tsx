import { Skeleton } from '@/components/ui/skeleton'

export default function ProviderCreditsLoading() {
  return (
    <div className="min-h-screen pb-32 px-[18px]">
      {/* Header */}
      <div className="pt-[60px] pb-6">
        <Skeleton className="h-9 w-32 rounded-[12px]" />
      </div>

      {/* Credits hero card */}
      <div
        className="rounded-[24px] p-5 mb-4 space-y-4"
        style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
      >
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-14 w-20 rounded-[12px]" />
        <div className="flex gap-3">
          <Skeleton className="flex-1 h-11 rounded-[14px]" />
          <Skeleton className="h-11 w-20 rounded-[14px]" />
        </div>
      </div>

      {/* Payment options */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-[20px] p-5 mb-3 space-y-3"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-5 w-40 rounded-[8px]" />
          <Skeleton className="h-3 w-56 rounded-full" />
          <Skeleton className="h-11 w-full rounded-[14px]" />
        </div>
      ))}

      {/* Activity */}
      <div
        className="rounded-[20px] p-5 space-y-3"
        style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
      >
        <Skeleton className="h-3 w-20 rounded-full" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-28 rounded-full" />
              <Skeleton className="h-2.5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
