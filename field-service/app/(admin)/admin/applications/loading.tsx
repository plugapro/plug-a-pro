import { Skeleton } from '@/components/ui/skeleton'

export default function ApplicationsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>

      <div className="space-y-2">
        <div className="flex gap-4">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
