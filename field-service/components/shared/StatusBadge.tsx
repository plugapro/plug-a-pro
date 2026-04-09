import type { JobStatus, BookingStatus, MatchStatus, JobRequestStatus, QuoteStatus } from '@prisma/client'

const JOB_CONFIG: Record<JobStatus, { label: string; className: string }> = {
  SCHEDULED: { label: 'Scheduled', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  EN_ROUTE: { label: 'En Route', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  ARRIVED: { label: 'Arrived', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  STARTED: { label: 'In Progress', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  PAUSED: { label: 'Paused', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  PENDING_COMPLETION_CONFIRMATION: { label: 'Pending Confirmation', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  FAILED: { label: 'Failed', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  CALLBACK_REQUIRED: { label: 'Callback Required', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const BOOKING_CONFIG: Record<BookingStatus, { label: string; className: string }> = {
  SCHEDULED: { label: 'Scheduled', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  RESCHEDULED: { label: 'Rescheduled', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

const MATCH_CONFIG: Record<MatchStatus, { label: string; className: string }> = {
  MATCHED: { label: 'Matched', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  INSPECTION_SCHEDULED: { label: 'Inspection Scheduled', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  INSPECTION_COMPLETE: { label: 'Inspection Complete', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  QUOTED: { label: 'Quoted', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  QUOTE_APPROVED: { label: 'Quote Approved', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  QUOTE_DECLINED: { label: 'Quote Declined', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const JOB_REQUEST_CONFIG: Record<JobRequestStatus, { label: string; className: string }> = {
  PENDING_VALIDATION: { label: 'Pending Validation', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  OPEN: { label: 'Open', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  MATCHING: { label: 'Matching', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  MATCHED: { label: 'Matched', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  EXPIRED: { label: 'Expired', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const QUOTE_CONFIG: Record<QuoteStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  APPROVED: { label: 'Approved', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  DECLINED: { label: 'Declined', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  EXPIRED: { label: 'Expired', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500' },
  REVISED: { label: 'Revised', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
}

interface JobBadgeProps {
  status: JobStatus
  type: 'job'
}

interface BookingBadgeProps {
  status: BookingStatus
  type: 'booking'
}

interface MatchBadgeProps {
  status: MatchStatus
  type: 'match'
}

interface JobRequestBadgeProps {
  status: JobRequestStatus
  type: 'jobRequest'
}

interface QuoteBadgeProps {
  status: QuoteStatus
  type: 'quote'
}

type Props =
  | JobBadgeProps
  | BookingBadgeProps
  | MatchBadgeProps
  | JobRequestBadgeProps
  | QuoteBadgeProps

export function StatusBadge({ status, type }: Props) {
  let config: { label: string; className: string } | undefined

  if (type === 'job') {
    config = JOB_CONFIG[status as JobStatus]
  } else if (type === 'booking') {
    config = BOOKING_CONFIG[status as BookingStatus]
  } else if (type === 'match') {
    config = MATCH_CONFIG[status as MatchStatus]
  } else if (type === 'jobRequest') {
    config = JOB_REQUEST_CONFIG[status as JobRequestStatus]
  } else {
    config = QUOTE_CONFIG[status as QuoteStatus]
  }

  if (!config) return null

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  )
}
