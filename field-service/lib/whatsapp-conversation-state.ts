import type { FlowName, ConversationData } from './whatsapp-flows/types'

/**
 * Per-flow data key whitelist. Keys not listed for the target flow are stripped
 * when transitioning. Conservative: when in doubt, add the key to the relevant
 * whitelist rather than relying on the strip.
 *
 * Keep this in sync with what each flow handler actually reads from ctx.data.
 *
 * The SHARED set is included in every flow because these keys are cross-flow
 * by design (recovery markers, customer identity, cron dedupe state).
 */
const SHARED_KEYS = [
  // Cross-flow conflict markers used by provider-onboarding-recovery
  'flowConflictDetectedAt', 'flowConflictFrom', 'flowConflictTo',
  // Cron dedupe state — session-warning writes this on the data JSON
  'prewarningSentAt',
  // Customer identity is needed across flows for greeting + recovery copy
  'customerName', 'customerId',
  // CTWA ad attribution — captured on the first inbound message and carried
  // until an application/job request can persist it (lib/whatsapp-referral.ts)
  'ctwaReferral',
] as const

const FLOW_DATA_WHITELIST: Record<FlowName, ReadonlyArray<string>> = {
  idle: [
    ...SHARED_KEYS,
  ],
  registration: [
    ...SHARED_KEYS,
    'name', 'proposedName',
    'skills', 'serviceAreas', 'province', 'provinceKey', 'regionId', 'regionLabel',
    'selectedRegionLabels', 'selectedRegionStatus', 'selectedSuburbLabels', 'locationNodeIds',
    'city', 'cityId', 'suburbPage', 'suburbPageTotal', 'suburbOptions',
    'verificationMethod', 'providerIdNumber',
    'verificationDocAttachmentId', 'verificationDocMediaId',
    'verificationSelfieAttachmentId', 'verificationSelfieMediaId',
    'experience', 'availability',
    'callOutFee', 'hourlyRate', 'rateNegotiable', 'hourlyRateSkipped',
    'providerBio', 'providerBioSkipped',
    'profilePhotoAttachmentId', 'profilePhotoMediaId', 'profilePhotoSkipped',
    'reference1Name', 'reference1Mobile', 'reference2Name', 'reference2Mobile',
    'preferredLanguage', 'alternateMobileE164',
    'highRiskServiceLabels',
    'evidenceNote', 'evidenceFileUrls', 'evidenceMediaIds',
    'certificationProofIntent', 'certificationProofAttachmentIds', 'certificationProofMediaIds',
    'providerEmail',
    'applicationId',
  ],
  job_request: [
    ...SHARED_KEYS,
    'category', 'selectedCategory',
    'addressLine1', 'addressStreet', 'addressSuburb', 'addressCity', 'addressRawSuburb',
    'addressLocationNodeId',
    'addrProvinceKey', 'addrProvinceLabel',
    'addrCityId', 'addrCityLabel',
    'addrRegionId', 'addrRegionLabel',
    'addrLocationNodeId', 'addrSuburbLabel', 'addrPostalCode',
    'addrPage',
    'isFirstBooking', 'hasSavedAddress', 'savedAddressId',
    'address',
    'issueDescription', 'availabilityNote', 'urgency',
    'providerPreference', 'budgetPreference', 'verifiedOnly',
    'photoAttachmentIds', 'photoMediaIds',
    'jobRequestId', 'matchId',
  ],
  status: [
    ...SHARED_KEYS,
  ],
  help: [
    ...SHARED_KEYS,
  ],
  reschedule: [
    ...SHARED_KEYS,
    'rescheduleBookingId', 'rescheduleReason',
  ],
  cancel: [
    ...SHARED_KEYS,
  ],
  provider_journey: [
    ...SHARED_KEYS,
    'availableNow', 'activeJobId', 'statusUpdate',
    'identityVerificationId', 'identityVerificationBasis',
    'identityVerificationDocumentKinds', 'identityVerificationDocumentIds',
    'identityVerificationSelfieDocumentId',
    'identityConsentVendorKey', 'identityConsentVendorDisplayName', 'identityConsentText',
    'pendingOpportunityLeadId', 'providerOpportunityStep',
    'providerOpportunityCallOutFeeText', 'providerOpportunityEstimatedArrivalAtIso',
    'providerOpportunityNegotiable',
    'pendingCompletionJobId', 'providerCompletionStep', 'providerCompletionNote',
  ],
  provider_job: [
    ...SHARED_KEYS,
    'pendingJobId', 'declineReason', 'activeJobId',
  ],
  alt_slot: [
    ...SHARED_KEYS,
    'altSlotJobRequestId', 'altSlotPendingProviderId',
  ],
}

export function clearIncompatibleFlowData(
  fromFlow: FlowName,
  toFlow: FlowName,
  data: ConversationData,
): ConversationData {
  if (fromFlow === toFlow) return data
  const allowed = new Set(FLOW_DATA_WHITELIST[toFlow] ?? [])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (allowed.has(key)) out[key] = value
  }
  return out as ConversationData
}

/**
 * Keys that must survive a conversation session reset (TTL expiry, reset
 * keywords like "hi"/"menu", ad-deeplink restarts). Everything else is
 * transient flow state and should be dropped.
 *
 * ctwaReferral is the canonical case: ad attribution is captured on the FIRST
 * inbound message, but cold leads routinely reply days after their session
 * expired — the 2026-07-02 recovery campaign lost attribution on 8/10
 * resulting applications because the expiry reset wiped it before submit.
 */
const RESET_SURVIVING_KEYS = ['ctwaReferral'] as const

export function resetConversationData(data: ConversationData | null | undefined): ConversationData {
  if (!data) return {}
  const out: Record<string, unknown> = {}
  for (const key of RESET_SURVIVING_KEYS) {
    const value = (data as Record<string, unknown>)[key]
    if (value != null) out[key] = value
  }
  return out as ConversationData
}
