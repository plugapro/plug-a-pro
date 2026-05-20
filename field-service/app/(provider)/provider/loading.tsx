import { Skeleton } from '@/components/ui/skeleton'

export default function ProviderHomeLoading() {
  return (
    <div className="pb-6">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5">
        <div className="flex items-center mb-4">
          <Skeleton className="h-[26px] w-[100px] rounded-lg" />
          <div className="flex-1" />
          <Skeleton className="w-9 h-9 rounded-[12px]" />
        </div>
        <Skeleton className="h-2.5 w-24 rounded mb-2" />
        <Skeleton className="h-8 w-40 rounded mb-2" />
        <Skeleton className="h-4 w-56 rounded" />
      </div>

      <div className="px-[18px] space-y-5">
        {/* Credits hero card */}
        <Skeleton className="h-[148px] w-full rounded-[24px]" />

        {/* Stats row - 3 cards */}
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[86px] rounded-[20px]" />
          ))}
        </div>

        {/* Availability toggle card */}
        <Skeleton className="h-[76px] w-full rounded-[24px]" />

        {/* New leads section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
          <div className="space-y-2.5">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-[100px] w-full rounded-[20px]" />
            ))}
          </div>
        </div>

        {/* In progress */}
        <div>
          <Skeleton className="h-3 w-28 rounded mb-3" />
          <Skeleton className="h-[80px] w-full rounded-[24px]" />
        </div>
      </div>
    </div>
  )
}
