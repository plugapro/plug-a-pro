import { Skeleton } from '@/components/ui/skeleton'

export default function TechnicianLoading() {
  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-4">
      <Skeleton className="h-7 w-40" />
      <div className="space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="rounded-xl border p-4 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}
