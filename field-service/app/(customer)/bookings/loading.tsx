import { ListSkeleton, Skeleton } from '@/components/shared/LoadingSkeleton'

export default function CustomerBookingsLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <ListSkeleton rows={3} />
    </div>
  )
}
