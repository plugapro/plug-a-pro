import {
  ListSkeleton,
  Skeleton,
  StatGridSkeleton,
} from '@/components/shared/LoadingSkeleton'

export default function ProviderHomeLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <StatGridSkeleton count={4} />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <ListSkeleton rows={2} />
    </div>
  )
}
