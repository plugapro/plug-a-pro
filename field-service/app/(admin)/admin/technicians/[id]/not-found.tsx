import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function TechnicianNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <h1 className="text-xl font-semibold">Provider not found</h1>
      <p className="text-muted-foreground text-sm">This provider may have been deleted or the ID is incorrect.</p>
      <Button asChild variant="outline">
        <Link href="/admin/providers">Back to providers</Link>
      </Button>
    </div>
  )
}
