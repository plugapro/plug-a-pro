import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function BookingNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <h1 className="text-xl font-semibold">Booking not found</h1>
      <p className="text-muted-foreground text-sm">This booking may have been deleted or the ID is incorrect.</p>
      <Button asChild variant="outline">
        <Link href="/admin/bookings">Back to bookings</Link>
      </Button>
    </div>
  )
}
