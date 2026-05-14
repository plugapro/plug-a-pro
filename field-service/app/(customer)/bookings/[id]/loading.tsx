import { Skeleton } from '@/components/ui/skeleton'

export default function BookingDetailLoading() {
  return (
    <div className="min-h-screen">
      {/* Hero band skeleton */}
      <div className="h-[180px] w-full" style={{ background: 'var(--card-alt)' }} />

      {/* Floating card skeleton */}
      <div className="px-[18px]">
        <div
          className="rounded-[20px] -mt-[64px] relative z-10 p-5 space-y-4"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          {/* Icon + status row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-[16px]" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-36 rounded-[8px]" />
                <Skeleton className="h-3 w-24 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-px mt-1 rounded-[14px] overflow-hidden border border-[var(--border)]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="py-3 px-2 text-center" style={{ background: 'var(--card-alt)' }}>
                <Skeleton className="h-5 w-12 rounded-[6px] mx-auto mb-1" />
                <Skeleton className="h-2.5 w-10 rounded-full mx-auto" />
              </div>
            ))}
          </div>

          {/* Provider row */}
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="w-7 h-7 rounded-full" />
            <Skeleton className="h-3 w-28 rounded-full" />
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-3 mt-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-[20px] p-5 space-y-3"
              style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
            >
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="h-4 w-full rounded-[8px]" />
              <Skeleton className="h-4 w-3/4 rounded-[8px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
