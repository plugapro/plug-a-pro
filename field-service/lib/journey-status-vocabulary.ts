import type { AssignmentMode, JobRequestStatus, LeadStatus } from '@prisma/client'

// Canonical request-state vocabulary used in blueprint and release artifacts.
// We keep persisted enums unchanged and map them into this shared vocabulary.
export type BlueprintRequestState =
  | 'awaiting_matching_mode'
  | 'quick_match_active'
  | 'quick_match_rotating'
  | 'review_matching_started'
  | 'provider_options_ready'
  | 'waiting_for_provider_responses'
  | 'provider_responses_received'
  | 'customer_selected_provider'
  | 'provider_final_acceptance_pending'
  | 'provider_confirmed'
  | 'no_provider_available'
  | 'cancelled'
  | 'expired'

export type BlueprintLeadState =
  | 'invited'
  | 'viewed'
  | 'responded_available'
  | 'declined'
  | 'expired'
  | 'customer_selected'
  | 'accepted'
  | 'superseded'
  | 'cancelled'

export function mapRequestStatusToBlueprintState(params: {
  status: JobRequestStatus
  assignmentMode: AssignmentMode
  hasInterestedProviders?: boolean
  hasProviderOptions?: boolean
}): BlueprintRequestState {
  const { status, assignmentMode, hasInterestedProviders, hasProviderOptions } = params

  if (status === 'PENDING_VALIDATION') {
    return assignmentMode === 'OPS_REVIEW' && hasProviderOptions
      ? 'provider_options_ready'
      : 'awaiting_matching_mode'
  }
  if (status === 'OPEN') {
    return assignmentMode === 'OPS_REVIEW' ? 'review_matching_started' : 'quick_match_active'
  }
  if (status === 'MATCHING') {
    if (assignmentMode === 'AUTO_ASSIGN') return 'quick_match_rotating'
    return hasInterestedProviders ? 'provider_responses_received' : 'waiting_for_provider_responses'
  }
  if (status === 'SHORTLIST_READY') return 'provider_responses_received'
  if (status === 'PROVIDER_CONFIRMATION_PENDING') return 'provider_final_acceptance_pending'
  if (status === 'MATCHED') return 'provider_confirmed'
  if (status === 'EXPIRED') return 'no_provider_available'
  if (status === 'CANCELLED') return 'cancelled'
  return 'expired'
}

export function mapLeadStatusToBlueprintState(status: LeadStatus): BlueprintLeadState {
  if (status === 'SENT') return 'invited'
  if (status === 'VIEWED') return 'viewed'
  if (status === 'INTERESTED') return 'responded_available'
  if (status === 'DECLINED') return 'declined'
  if (status === 'EXPIRED') return 'expired'
  if (status === 'SHORTLISTED') return 'responded_available'
  if (status === 'CUSTOMER_SELECTED') return 'customer_selected'
  if (status === 'ACCEPTED') return 'accepted'
  if (status === 'SUPERSEDED') return 'superseded'
  if (status === 'CANCELLED') return 'cancelled'
  return 'expired'
}

export const REQUEST_STATUS_VOCABULARY_MATRIX: Record<JobRequestStatus, {
  AUTO_ASSIGN: BlueprintRequestState
  OPS_REVIEW: BlueprintRequestState
}> = {
  PENDING_VALIDATION: {
    AUTO_ASSIGN: 'awaiting_matching_mode',
    OPS_REVIEW: 'awaiting_matching_mode',
  },
  OPEN: {
    AUTO_ASSIGN: 'quick_match_active',
    OPS_REVIEW: 'review_matching_started',
  },
  MATCHING: {
    AUTO_ASSIGN: 'quick_match_rotating',
    OPS_REVIEW: 'waiting_for_provider_responses',
  },
  SHORTLIST_READY: {
    AUTO_ASSIGN: 'provider_responses_received',
    OPS_REVIEW: 'provider_responses_received',
  },
  PROVIDER_CONFIRMATION_PENDING: {
    AUTO_ASSIGN: 'provider_final_acceptance_pending',
    OPS_REVIEW: 'provider_final_acceptance_pending',
  },
  MATCHED: {
    AUTO_ASSIGN: 'provider_confirmed',
    OPS_REVIEW: 'provider_confirmed',
  },
  EXPIRED: {
    AUTO_ASSIGN: 'no_provider_available',
    OPS_REVIEW: 'no_provider_available',
  },
  CANCELLED: {
    AUTO_ASSIGN: 'cancelled',
    OPS_REVIEW: 'cancelled',
  },
}
