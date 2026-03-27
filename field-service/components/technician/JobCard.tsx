import Link from 'next/link'
import type { Job, Booking, Customer, Service, Address } from '@prisma/client'
import { StatusBadge } from '@/components/shared/StatusBadge'

type JobWithContext = Job & {
  booking:
    | (Booking & {
        customer: Customer
        service: Service
        address: Address
      })
    | null
}

interface Props {
  job: JobWithContext
}

export function JobCard({ job }: Props) {
  const booking = job.booking
  if (!booking) return null

  const { customer, service, address } = booking

  return (
    <Link
      href={`/technician/jobs/${job.id}`}
      className="block rounded-xl border bg-card p-4 hover:bg-accent/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{service.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {customer.name} · {customer.phone}
          </p>
        </div>
        <StatusBadge status={job.status} type="job" />
      </div>

      <div className="rounded-md bg-muted px-3 py-2">
        <p className="text-xs font-medium">
          {address.street}, {address.suburb}
        </p>
        <p className="text-xs text-muted-foreground">{address.city}</p>
      </div>

      {booking.scheduledWindow && (
        <p className="text-xs text-muted-foreground mt-2">
          Window: {booking.scheduledWindow}
        </p>
      )}
    </Link>
  )
}
