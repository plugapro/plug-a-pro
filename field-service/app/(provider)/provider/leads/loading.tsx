import { ListSkeleton, Skeleton } from '@/components/shared/LoadingSkeleton'

export default function ProviderLeadsLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <ListSkeleton rows={4} />
    </div>
  )
}
