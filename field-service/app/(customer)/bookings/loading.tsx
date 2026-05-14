import { Skeleton } from '@/components/ui/skeleton'

export default function CustomerBookingsLoading() {
  return (
    <div className="px-[18px] pt-[60px] pb-8 space-y-5">
      <Skeleton className="h-9 w-44 rounded-[12px]" />
      <Skeleton className="h-4 w-40 rounded-[8px]" />
      <div className="flex gap-2 pt-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-3 pt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-[20px] bg-card shadow-[inset_0_0_0_1px_var(--border)] p-4 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="h-3 w-16 rounded-full" />
            </div>
            <Skeleton className="h-5 w-44 rounded-[8px]" />
            <Skeleton className="h-3 w-32 rounded-full" />
            <div className="border-t border-[var(--border)] pt-3 flex justify-between">
              <Skeleton className="h-3 w-28 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-[10px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
