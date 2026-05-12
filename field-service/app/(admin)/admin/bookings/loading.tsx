import { ListSkeleton } from '@/components/shared/LoadingSkeleton'

export default function BookingsLoading() {
  return <ListSkeleton rows={6} className="p-6" />
}
