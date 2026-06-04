import type { FlowName, ConversationData } from './whatsapp-flows/types'

/**
 * Per-flow data key whitelist. Keys not listed for the target flow are stripped
 * when transitioning. Conservative: when in doubt, add the key to the relevant
 * whitelist rather than relying on the strip.
 *
 * Keep this in sync with what each flow handler actually reads from ctx.data.
 */
const FLOW_DATA_WHITELIST: Record<FlowName, ReadonlyArray<string>> = {
  idle: [
    // Continuation hints used by the welcome handler to recognise a returning user
    // mid-task. Keep small.
    'customerName',
  ],
  registration: [
    'name', 'skills', 'serviceAreas', 'province', 'provinceKey', 'regionId', 'regionLabel',
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
    'customerName', 'customerId',
  ],
  status: ['customerName', 'customerId'],
  help: [],
  reschedule: ['rescheduleBookingId', 'rescheduleReason', 'customerName', 'customerId'],
  cancel: ['customerName', 'customerId'],
  provider_journey: [
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
  provider_job: ['pendingJobId', 'declineReason', 'activeJobId'],
  alt_slot: ['altSlotJobRequestId', 'altSlotPendingProviderId'],
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
