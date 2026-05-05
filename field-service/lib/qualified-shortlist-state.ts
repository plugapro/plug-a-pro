import type {
  JobRequestStatus,
  KycStatus,
  LeadStatus,
  MatchStatus,
  ProviderStatus,
} from '@prisma/client'

export type QualifiedProviderState =
  | 'draft_application'
  | 'application_submitted'
  | 'pending_review'
  | 'more_info_required'
  | 'approved'
  | 'trusted'
  | 'suspended'
  | 'rejected'
  | 'inactive'

export type QualifiedRequestState =
  | 'draft'
  | 'submitted'
  | 'matching'
  | 'awaiting_provider_responses'
  | 'shortlist_ready'
  | 'customer_selection_pending'
  | 'provider_confirmation_pending'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired'

export type QualifiedLeadInviteState =
  | 'created'
  | 'sent'
  | 'viewed'
  | 'interested'
  | 'not_interested'
  | 'expired'
  | 'shortlisted'
  | 'customer_selected'
  | 'provider_accepted'
  | 'provider_declined_after_selection'
  | 'superseded'
  | 'cancelled'

export type QualifiedJobState =
  | 'pending_assignment'
  | 'provider_selected'
  | 'assigned'
  | 'arrival_time_pending'
  | 'arrival_time_confirmed'
  | 'on_the_way'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'disputed'

type ProviderStateInput = {
  active?: boolean | null
  verified?: boolean | null
  status?: ProviderStatus | string | null
  kycStatus?: KycStatus | string | null
  completedJobsCount?: number | null
  averageRating?: number | null
}

type RequestStateInput = {
  status?: JobRequestStatus | string | null
  match?: { status?: MatchStatus | string | null } | null
}

type LeadInviteStateInput = {
  status?: LeadStatus | string | null
  expiresAt?: Date | null
  respondedAt?: Date | null
  shortlistItem?: unknown | null
  customerSelectedAt?: Date | null
  providerAcceptedAt?: Date | null
  supersededAt?: Date | null
  cancelledAt?: Date | null
}

type JobStateInput = {
  status?: string | null
}

export const QUALIFIED_PROVIDER_STATE_RULES: Record<QualifiedProviderState, {
  receiveLeads: boolean
  appearInShortlist: boolean
  workerPortalAccess: 'none' | 'limited' | 'full' | 'read_only_or_blocked'
}> = {
  draft_application: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'none' },
  application_submitted: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'limited' },
  pending_review: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'limited' },
  more_info_required: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'limited' },
  approved: { receiveLeads: true, appearInShortlist: true, workerPortalAccess: 'full' },
  trusted: { receiveLeads: true, appearInShortlist: true, workerPortalAccess: 'full' },
  suspended: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'read_only_or_blocked' },
  rejected: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'none' },
  inactive: { receiveLeads: false, appearInShortlist: false, workerPortalAccess: 'read_only_or_blocked' },
}

export function mapProviderToQualifiedState(provider: ProviderStateInput | null | undefined): QualifiedProviderState {
  // Provider.active is the broad account switch; inactive accounts cannot be
  // matched even when historical status fields look approved.
  if (!provider) return 'draft_application'
  if (provider.active === false) return 'inactive'

  // Hard moderation states always override marketplace-review flags.
  if (provider.status === 'SUSPENDED' || provider.status === 'BANNED') return 'suspended'
  if (provider.status === 'ARCHIVED') return 'inactive'
  if (provider.status === 'APPLICATION_PENDING') return 'application_submitted'
  if (provider.status === 'UNDER_REVIEW') return 'pending_review'

  // The current schema uses Provider.verified as marketplace approval. KYC is
  // tracked separately and can promote an approved provider into trusted state.
  if (provider.status === 'ACTIVE' && provider.verified === true) {
    if (
      provider.kycStatus === 'VERIFIED' &&
      (provider.completedJobsCount ?? 0) > 0 &&
      (provider.averageRating ?? 0) >= 4.5
    ) {
      return 'trusted'
    }
    return 'approved'
  }

  return 'pending_review'
}

export function mapRequestToQualifiedState(request: RequestStateInput | null | undefined): QualifiedRequestState {
  if (!request?.status) return 'draft'

  // Existing request statuses are coarser than the target shortlist lifecycle,
  // so this mapper preserves backwards compatibility until shortlist fields land.
  if (request.status === 'PENDING_VALIDATION') return 'submitted'
  if (request.status === 'OPEN') return 'matching'
  if (request.status === 'MATCHING') return 'awaiting_provider_responses'
  if (request.status === 'SHORTLIST_READY') return 'shortlist_ready'
  if (request.status === 'PROVIDER_CONFIRMATION_PENDING') return 'provider_confirmation_pending'
  if (request.status === 'MATCHED') {
    if (request.match?.status === 'QUOTE_APPROVED') return 'scheduled'
    if (request.match?.status === 'CANCELLED') return 'cancelled'
    return 'assigned'
  }
  if (request.status === 'EXPIRED') return 'expired'
  if (request.status === 'CANCELLED') return 'cancelled'

  return 'submitted'
}

export function mapLeadInviteToQualifiedState(invite: LeadInviteStateInput | null | undefined): QualifiedLeadInviteState {
  if (!invite?.status) return 'created'
  if (invite.cancelledAt) return 'cancelled'
  if (invite.supersededAt) return 'superseded'
  if (invite.providerAcceptedAt) return 'provider_accepted'
  if (invite.customerSelectedAt) return 'customer_selected'
  if (invite.expiresAt && invite.expiresAt <= new Date() && invite.status !== 'ACCEPTED') return 'expired'

  if (invite.status === 'SENT') return 'sent'
  if (invite.status === 'VIEWED') return 'viewed'
  if (invite.status === 'INTERESTED') return 'interested'
  if (invite.status === 'SHORTLISTED') return 'shortlisted'
  if (invite.status === 'CUSTOMER_SELECTED') return 'customer_selected'
  if (invite.status === 'SUPERSEDED') return 'superseded'
  if (invite.status === 'CANCELLED') return 'cancelled'
  if (invite.status === 'DECLINED') return 'not_interested'
  if (invite.status === 'EXPIRED') return 'expired'
  if (invite.status === 'ACCEPTED') return 'provider_accepted'
  if (invite.shortlistItem) return 'shortlisted'

  return 'created'
}

export function mapJobToQualifiedState(job: JobStateInput | null | undefined): QualifiedJobState {
  if (!job?.status) return 'pending_assignment'
  if (job.status === 'SCHEDULED') return 'assigned'
  if (job.status === 'EN_ROUTE') return 'on_the_way'
  if (job.status === 'ARRIVED') return 'arrived'
  if (job.status === 'STARTED' || job.status === 'PAUSED' || job.status === 'AWAITING_APPROVAL') return 'in_progress'
  if (job.status === 'PENDING_COMPLETION_CONFIRMATION') return 'in_progress'
  if (job.status === 'COMPLETED') return 'completed'
  if (job.status === 'CANCELLED' || job.status === 'FAILED') return 'cancelled'
  if (job.status === 'CALLBACK_REQUIRED') return 'disputed'
  return 'pending_assignment'
}

export function canProviderReceiveLeads(provider: ProviderStateInput | null | undefined) {
  return QUALIFIED_PROVIDER_STATE_RULES[mapProviderToQualifiedState(provider)].receiveLeads
}

export function canProviderAppearInShortlist(provider: ProviderStateInput | null | undefined) {
  return QUALIFIED_PROVIDER_STATE_RULES[mapProviderToQualifiedState(provider)].appearInShortlist
}

export function canProviderAccessWorkerPortal(provider: ProviderStateInput | null | undefined) {
  return QUALIFIED_PROVIDER_STATE_RULES[mapProviderToQualifiedState(provider)].workerPortalAccess !== 'none'
}

export function canRequestRunMatching(request: RequestStateInput | null | undefined) {
  const state = mapRequestToQualifiedState(request)
  return state === 'submitted' || state === 'matching' || state === 'awaiting_provider_responses'
}

export function canLeadInviteReceiveProviderResponse(invite: LeadInviteStateInput | null | undefined) {
  const state = mapLeadInviteToQualifiedState(invite)
  return state === 'sent' || state === 'viewed' || state === 'interested'
}

export function canCustomerSelectProvider(invite: LeadInviteStateInput | null | undefined) {
  const state = mapLeadInviteToQualifiedState(invite)
  return state === 'interested' || state === 'shortlisted'
}

export function canProviderAcceptSelectedJob(
  invite: LeadInviteStateInput | null | undefined,
  request: RequestStateInput | null | undefined,
  provider: ProviderStateInput | null | undefined,
) {
  return (
    mapLeadInviteToQualifiedState(invite) === 'customer_selected' &&
    mapRequestToQualifiedState(request) === 'provider_confirmation_pending' &&
    canProviderReceiveLeads(provider)
  )
}

export function canProviderViewFullJobDetails(
  jobOrLead: { acceptedProviderId?: string | null; providerId?: string | null; isUnlocked?: boolean | null } | null | undefined,
  provider: { id?: string | null } | null | undefined,
) {
  // Full customer data is only visible after the server has a persisted unlock
  // or accepted assignment tied to the same provider.
  if (!jobOrLead || !provider?.id) return false
  if (jobOrLead.isUnlocked && jobOrLead.providerId === provider.id) return true
  return jobOrLead.acceptedProviderId === provider.id
}

export function canShowExpiryCountdown(invite: LeadInviteStateInput | null | undefined) {
  const state = mapLeadInviteToQualifiedState(invite)
  return state === 'sent' || state === 'viewed' || state === 'interested'
}
