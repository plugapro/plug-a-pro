import type { ComponentProps } from 'react'
import type { JobStatus, BookingStatus, MatchStatus, JobRequestStatus, QuoteStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

const JOB_CONFIG: Record<JobStatus, { label: string; variant: BadgeVariant }> = {
  SCHEDULED: { label: 'Scheduled', variant: 'neutral' },
  EN_ROUTE: { label: 'On the way', variant: 'info' },
  ARRIVED: { label: 'Arrived', variant: 'brand' },
  STARTED: { label: 'In Progress', variant: 'warning' },
  PAUSED: { label: 'Paused', variant: 'neutral' },
  AWAITING_APPROVAL: { label: 'Needs approval', variant: 'warning' },
  PENDING_COMPLETION_CONFIRMATION: { label: 'Ready for sign-off', variant: 'brand' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'danger' },
  FAILED: { label: 'Failed', variant: 'danger' },
  CALLBACK_REQUIRED: { label: 'Follow-up needed', variant: 'danger' },
}

const BOOKING_CONFIG: Record<BookingStatus, { label: string; variant: BadgeVariant }> = {
  SCHEDULED: { label: 'Scheduled', variant: 'brand' },
  RESCHEDULED: { label: 'Rescheduled', variant: 'neutral' },
  CANCELLED: { label: 'Cancelled', variant: 'danger' },
  COMPLETED: { label: 'Completed', variant: 'success' },
}

const MATCH_CONFIG: Record<MatchStatus, { label: string; variant: BadgeVariant }> = {
  MATCHED: { label: 'Matched', variant: 'info' },
  INSPECTION_SCHEDULED: { label: 'Visit arranged', variant: 'brand' },
  INSPECTION_COMPLETE: { label: 'Visit done', variant: 'neutral' },
  QUOTED: { label: 'Quote sent', variant: 'warning' },
  QUOTE_APPROVED: { label: 'Quote approved', variant: 'success' },
  QUOTE_DECLINED: { label: 'Needs quote update', variant: 'danger' },
  CANCELLED: { label: 'Cancelled', variant: 'danger' },
}

const JOB_REQUEST_CONFIG: Record<JobRequestStatus, { label: string; variant: BadgeVariant }> = {
  PENDING_VALIDATION: { label: 'Draft', variant: 'neutral' },
  OPEN: { label: 'Open', variant: 'info' },
  MATCHING: { label: 'Matching', variant: 'brand' },
  SHORTLIST_READY: { label: 'Choose provider', variant: 'warning' },
  PROVIDER_CONFIRMATION_PENDING: { label: 'Provider confirming', variant: 'brand' },
  MATCHED: { label: 'Matched', variant: 'success' },
  EXPIRED: { label: 'Expired', variant: 'neutral' },
  CANCELLED: { label: 'Cancelled', variant: 'danger' },
}

const QUOTE_CONFIG: Record<QuoteStatus, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: 'Client reviewing', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  DECLINED: { label: 'Declined', variant: 'danger' },
  EXPIRED: { label: 'Expired', variant: 'neutral' },
  REVISED: { label: 'Revised', variant: 'info' },
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
  let config: { label: string; variant: BadgeVariant } | undefined

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
    <Badge variant={config.variant}>
      {config.label}
    </Badge>
  )
}
