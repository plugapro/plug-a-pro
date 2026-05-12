import { ListSkeleton } from '@/components/shared/LoadingSkeleton'

export default function MessagesLoading() {
  return <ListSkeleton rows={6} className="p-6" />
}
