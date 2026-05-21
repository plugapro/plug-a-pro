import type { JobStatus } from '@prisma/client'

export type ProviderPortalJobBucket = 'upcoming' | 'in_progress' | 'completed' | 'unsupported'

export const PROVIDER_UPCOMING_JOB_STATUSES = ['SCHEDULED'] as const satisfies readonly JobStatus[]
export const PROVIDER_IN_PROGRESS_JOB_STATUSES = [
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'PAUSED',
  'AWAITING_APPROVAL',
] as const satisfies readonly JobStatus[]

export const PROVIDER_COMPLETED_JOB_STATUSES = [
  'PENDING_COMPLETION_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'CALLBACK_REQUIRED',
] as const satisfies readonly JobStatus[]

const KNOWN_PROVIDER_JOB_STATUSES = new Set<JobStatus>([
  ...PROVIDER_UPCOMING_JOB_STATUSES,
  ...PROVIDER_IN_PROGRESS_JOB_STATUSES,
  ...PROVIDER_COMPLETED_JOB_STATUSES,
])
const PROVIDER_IN_PROGRESS_JOB_STATUS_SET = new Set<JobStatus>(PROVIDER_IN_PROGRESS_JOB_STATUSES)
const PROVIDER_UPCOMING_JOB_STATUS_SET = new Set<JobStatus>(PROVIDER_UPCOMING_JOB_STATUSES)
const PROVIDER_COMPLETED_JOB_STATUS_SET = new Set<JobStatus>(PROVIDER_COMPLETED_JOB_STATUSES)

export function isKnownProviderJobStatus(status: string): status is JobStatus {
  return KNOWN_PROVIDER_JOB_STATUSES.has(status as JobStatus)
}

export function bucketProviderPortalJob(params: {
  status: string
  scheduledDate?: Date | null
}): ProviderPortalJobBucket {
  const { status } = params
  if (!isKnownProviderJobStatus(status)) return 'unsupported'

  if (PROVIDER_IN_PROGRESS_JOB_STATUS_SET.has(status)) {
    return 'in_progress'
  }

  if (PROVIDER_UPCOMING_JOB_STATUS_SET.has(status)) {
    if (params.scheduledDate && Number.isNaN(params.scheduledDate.getTime())) {
      return 'unsupported'
    }
    // Keep all scheduled jobs out of "In progress" until work status changes.
    return 'upcoming'
  }

  if (PROVIDER_COMPLETED_JOB_STATUS_SET.has(status)) {
    return 'completed'
  }

  return 'unsupported'
}
