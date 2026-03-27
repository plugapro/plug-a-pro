import type { JobStatus, BookingStatus } from '@prisma/client'

const JOB_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  ASSIGNED: { label: 'Assigned', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  EN_ROUTE: { label: 'En Route', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  ARRIVED: { label: 'Arrived', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  STARTED: { label: 'In Progress', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  PAUSED: { label: 'Paused', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  FAILED: { label: 'Failed', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  CALLBACK_REQUIRED: { label: 'Callback Required', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const BOOKING_CONFIG: Record<BookingStatus, { label: string; className: string }> = {
  PENDING_PAYMENT: { label: 'Pending Payment', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  CONFIRMED: { label: 'Confirmed', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  SCHEDULED: { label: 'Scheduled', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  RESCHEDULED: { label: 'Rescheduled', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

interface JobBadgeProps {
  status: JobStatus
  type: 'job'
}

interface BookingBadgeProps {
  status: BookingStatus
  type: 'booking'
}

type Props = JobBadgeProps | BookingBadgeProps

export function StatusBadge({ status, type }: Props) {
  const config =
    type === 'job'
      ? JOB_CONFIG[status as JobStatus]
      : BOOKING_CONFIG[status as BookingStatus]

  if (!config) return null

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  )
}
