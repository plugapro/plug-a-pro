import { ListSkeleton } from '@/components/shared/LoadingSkeleton'

export default function LocationsLoading() {
  return <ListSkeleton rows={6} className="p-6" />
}
