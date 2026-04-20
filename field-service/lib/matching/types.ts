import type {
  AssignmentMode,
  AssignmentResponseOutcome,
  DispatchDecision,
  JobRequest,
  MatchAttempt,
  Provider,
  TechnicianAvailability,
  TechnicianCertification,
  TechnicianScheduleItem,
  TechnicianServiceArea,
  TechnicianSkill,
  ProviderCertification,
  ProviderEquipment,
} from '@prisma/client'

export type MatchingJobRequest = Pick<
  JobRequest,
  | 'id'
  | 'category'
  | 'title'
  | 'description'
  | 'requestedWindowStart'
  | 'requestedWindowEnd'
  | 'requestedArrivalLatest'
  | 'estimatedDurationMinutes'
  | 'requiredSkillTags'
  | 'requiredCertificationCodes'
  | 'preferredProviderId'
  | 'assignmentMode'
  | 'requiredEquipmentTags'
  | 'requiredVehicleTypes'
  | 'customerAcceptedAmount'
  | 'customerAcceptedScope'
  | 'autoCreateBookingOnAssignment'
  | 'status'
>

export type MatchingAddress = {
  street: string
  suburb: string
  city: string
  province: string
  lat: number | null
  lng: number | null
  locationNodeId: string | null   // SUBURB node id — null for legacy addresses
  regionKey: string | null         // denormalised from the linked LocationNode
}

export type MatchingProvider = Pick<
  Provider,
  | 'id'
  | 'name'
  | 'phone'
  | 'active'
  | 'availableNow'
  | 'verified'
  | 'skills'
  | 'serviceAreas'
  | 'averageRating'
  | 'reliabilityScore'
  | 'completedJobsCount'
  | 'onTimeRate'
  | 'acceptanceRate'
  | 'complaintCount'
  | 'complaintRate'
  | 'providerCancellationCount'
  | 'cancellationRate'
  | 'lateArrivalCount'
  | 'punctualityScore'
  | 'maxTravelMinutes'
  | 'lastKnownLat'
  | 'lastKnownLng'
  | 'lastKnownLocationLabel'
  | 'lastKnownLocationAt'
  | 'equipmentTags'
  | 'vehicleTypes'
> & {
  technicianSkills: TechnicianSkill[]
  technicianCertifications: TechnicianCertification[]
  technicianServiceAreas: TechnicianServiceArea[]
  technicianAvailability: TechnicianAvailability | null
  scheduleItems: TechnicianScheduleItem[]
  /** Verified ProviderCertification records (WS-B.1). Checked in addition to technicianCertifications. */
  adminCertifications?: Pick<ProviderCertification, 'name' | 'verifiedAt'>[]
  /** Active ProviderEquipment records (WS-B.1). Checked in addition to equipmentTags. */
  equipment?: Pick<ProviderEquipment, 'label' | 'category' | 'active'>[]
}

export type CoverageTier =
  | 'RADIUS'
  | 'SUBURB_EXACT'
  | 'REGION_FALLBACK'
  | 'LEGACY_STRING'
  | 'NO_MATCH'

export type FilteredCandidate = {
  providerId: string
  providerName: string
  filteredReasonCodes: string[]
}

export type ScoreBreakdown = {
  skillMatch: number
  scheduleFit: number
  travelEfficiency: number
  reliability: number
  customerPreference: number
  marginEfficiency: number
  geographicPenalty: number   // 0.0 normally; regionFallbackPenalty when tier = REGION_FALLBACK
  total: number
  reasons: string[]
}

export type RankedCandidate = {
  providerId: string
  providerName: string
  score: number
  scoreBreakdown: ScoreBreakdown
  filteredReasonCodes: string[]
  feasibilityNotes: string[]
  travelMinutes: number
  availabilityState: string
  canMeetWindow: boolean
  estimatedStartAt: Date | null
  estimatedEndAt: Date | null
  reliabilityIndicators: {
    reliabilityScore: number
    averageRating: number
    completedJobsCount: number
    onTimeRate: number
    acceptanceRate: number
    complaintRate: number
    cancellationRate: number
    punctualityScore: number
  }
  selectionReason: string
}

export type RankingResult = {
  jobRequestId: string
  assignmentMode: AssignmentMode
  consideredCount: number
  eligibleCount: number
  filteredOut: FilteredCandidate[]
  candidates: RankedCandidate[]
}

export type DispatchActor = {
  actorId: string
  actorRole: 'system' | 'admin'
}

export type DispatchRunResult = RankingResult & {
  dispatchDecisionId: string
  status: DispatchDecision['status']
  offeredProviderId: string | null
  assignmentHoldId: string | null
}

export type DispatchHistoryResult = {
  dispatchDecision: DispatchDecision
  attempts: MatchAttempt[]
}

export type OfferResolutionResult =
  | {
      ok: true
      responseOutcome: AssignmentResponseOutcome
      matchId: string | null
      bookingId?: string | null
      assignmentHoldId: string
      nextOfferedProviderId: string | null
    }
  | {
      ok: false
      reason: 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'TAKEN'
    }
