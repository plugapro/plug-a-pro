import { Skeleton } from '@/components/ui/skeleton'

export default function ProviderLoading() {
  return (
    <div className="px-[18px] pt-[60px] pb-8 space-y-5">
      <Skeleton className="h-9 w-48 rounded-[12px]" />
      <Skeleton className="h-4 w-40 rounded-[8px]" />
      <div className="rounded-[24px] bg-card shadow-[inset_0_0_0_1px_var(--border)] p-5 space-y-3">
        <Skeleton className="h-12 w-20 rounded-[8px]" />
        <div className="flex gap-2">
          <Skeleton className="flex-1 h-10 rounded-[12px]" />
          <Skeleton className="h-10 w-20 rounded-[12px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-[20px] border border-[var(--border)] p-4 space-y-2">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="h-8 w-12 rounded-[8px]" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-[20px] bg-card shadow-[inset_0_0_0_1px_var(--border)] p-4 space-y-2">
            <Skeleton className="h-5 w-40 rounded-[8px]" />
            <Skeleton className="h-3 w-48 rounded-full" />
            <div className="border-t border-[var(--border)] pt-3 flex justify-between">
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-[10px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
