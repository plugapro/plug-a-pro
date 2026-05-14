import { Skeleton } from '@/components/ui/skeleton'

export default function NotificationsLoading() {
  return (
    <div className="min-h-screen pb-32 px-[18px]">
      {/* Header */}
      <div className="pt-[60px] pb-4 flex items-center gap-3">
        <Skeleton className="w-9 h-9 rounded-full" />
        <Skeleton className="h-9 w-44 rounded-[12px]" />
      </div>

      {/* Notification rows */}
      <div className="space-y-2 pt-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-[18px] p-4 flex gap-3 items-start"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <Skeleton className="w-10 h-10 rounded-[12px] shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-3/4 rounded-full" />
              <Skeleton className="h-3 w-1/2 rounded-full" />
            </div>
            <Skeleton className="h-2.5 w-8 rounded-full mt-1 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
