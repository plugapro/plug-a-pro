import type { JobRequestStatus, JobStatus } from '@prisma/client'

export type ClientPwaScreen =
  | 'client_home'
  | 'request_form'
  | 'request_submitted'
  | 'matching_progress'
  | 'providers_reviewing'
  | 'shortlist'
  | 'provider_confirmation'
  | 'job_tracking'
  | 'active_job'
  | 'completion_review'
  | 'cancelled'
  | 'expired'
  | 'invalid_link'

export type ClientPwaAllowedAction =
  | 'start_request'
  | 'resume_request'
  | 'upload_photos'
  | 'view_matching_status'
  | 'view_shortlist'
  | 'select_provider'
  | 'request_more_options'
  | 'cancel_request'
  | 'view_provider_confirmation'
  | 'track_job'
  | 'confirm_completion'
  | 'leave_review'

export type ClientPwaStateResolution = {
  screen: ClientPwaScreen
  reason: string
}

// Convert persisted backend request and job states into the single PWA screen contract.
export function resolveClientPwaScreenForState(params: {
  requestStatus?: JobRequestStatus | null
  jobStatus?: JobStatus | null
}): ClientPwaStateResolution {
  if (!params.requestStatus) {
    return { screen: 'client_home', reason: 'no_active_request' }
  }

  if (params.requestStatus === 'MATCHED' && params.jobStatus) {
    return resolveClientPwaScreenForJobStatus(params.jobStatus)
  }

  switch (params.requestStatus) {
    case 'PENDING_VALIDATION':
      return { screen: 'request_submitted', reason: 'request_awaiting_validation' }
    case 'OPEN':
      return { screen: 'matching_progress', reason: 'request_open_matching_can_start' }
    case 'MATCHING':
      return { screen: 'providers_reviewing', reason: 'providers_reviewing_request' }
    case 'SHORTLIST_READY':
      return { screen: 'shortlist', reason: 'shortlist_ready_for_customer_selection' }
    case 'PROVIDER_CONFIRMATION_PENDING':
      return { screen: 'provider_confirmation', reason: 'selected_provider_confirming' }
    case 'MATCHED':
      return { screen: 'job_tracking', reason: 'provider_accepted_or_job_assigned' }
    case 'EXPIRED':
      return { screen: 'expired', reason: 'request_expired' }
    case 'CANCELLED':
      return { screen: 'cancelled', reason: 'request_cancelled' }
  }
}

// Job records supersede the request screen once a provider has accepted and work can be tracked.
export function resolveClientPwaScreenForJobStatus(status: JobStatus): ClientPwaStateResolution {
  switch (status) {
    case 'SCHEDULED':
    case 'EN_ROUTE':
      return { screen: 'job_tracking', reason: 'job_scheduled_or_provider_en_route' }
    case 'ARRIVED':
    case 'STARTED':
    case 'PAUSED':
    case 'AWAITING_APPROVAL':
    case 'PENDING_COMPLETION_CONFIRMATION':
    case 'CALLBACK_REQUIRED':
      return { screen: 'active_job', reason: 'job_active_or_needs_customer_attention' }
    case 'COMPLETED':
      return { screen: 'completion_review', reason: 'job_completed_review_available' }
    case 'CANCELLED':
    case 'FAILED':
      return { screen: 'cancelled', reason: 'job_cancelled_or_failed' }
  }
}

// Allowed actions are derived from the resolved screen so UI surfaces remain consistent.
export function allowedActionsForClientPwaScreen(screen: ClientPwaScreen): ClientPwaAllowedAction[] {
  switch (screen) {
    case 'client_home':
      return ['start_request']
    case 'request_form':
      return ['resume_request', 'upload_photos', 'cancel_request']
    case 'request_submitted':
    case 'matching_progress':
      return ['view_matching_status', 'upload_photos', 'cancel_request']
    case 'providers_reviewing':
      return ['view_matching_status', 'cancel_request']
    case 'shortlist':
      return ['view_shortlist', 'select_provider', 'request_more_options', 'cancel_request']
    case 'provider_confirmation':
      return ['view_provider_confirmation']
    case 'job_tracking':
      return ['track_job']
    case 'active_job':
      return ['track_job', 'confirm_completion']
    case 'completion_review':
      return ['track_job', 'leave_review']
    case 'cancelled':
    case 'expired':
    case 'invalid_link':
      return []
  }
}
