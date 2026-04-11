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
}

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
