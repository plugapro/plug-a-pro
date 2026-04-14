import Link from 'next/link'
import type { Job, Booking, Match, JobRequest, Customer, Address } from '@prisma/client'
import { StatusBadge } from '@/components/shared/StatusBadge'

type JobWithContext = Job & {
  booking: Booking & {
    match: Match & {
      jobRequest: JobRequest & {
        customer: Customer
        address:  Address | null
      }
    }
  }
}

interface Props {
  job: JobWithContext
  basePath?: '/provider' | '/technician'
}

export function JobCard({ job, basePath = '/technician' }: Props) {
  const { jobRequest } = job.booking.match
  const { customer, address } = jobRequest

  return (
    <Link
      href={`${basePath}/jobs/${job.id}`}
      className="block rounded-xl border bg-card p-4 hover:bg-accent/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate capitalize">{jobRequest.category}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {customer.name} · {customer.phone}
          </p>
        </div>
        <StatusBadge status={job.status} type="job" />
      </div>

      {address && (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs font-medium">
            {address.street}, {address.suburb}
          </p>
          <p className="text-xs text-muted-foreground">{address.city}</p>
        </div>
      )}

      {job.booking.scheduledWindow && (
        <p className="text-xs text-muted-foreground mt-2">
          Window: {job.booking.scheduledWindow}
        </p>
      )}
    </Link>
  )
}
