import { CardSkeleton } from '@/components/shared/LoadingSkeleton'

export default function CustomerDetailLoading() {
  return (
    <div className="space-y-4 p-6">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
