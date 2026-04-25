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
  provinceKey: string | null       // denormalised from the linked LocationNode — enables province-level pool fallback
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
  workloadFairness: number    // 1 = below preferredDailyLoad; 0 = at/above
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
  reservationFailureReason?: string  // populated by orchestrator after reservation attempt
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

// ── Alternative-slot negotiation ─────────────────────────────────────────────

/**
 * One bookable window discovered during the alternative-slot probe.
 * slotKey is stable across WA button round-trips: "2026-04-29:morning"
 */
export type SlotOption = {
  slotKey: string       // "{yyyy-MM-dd}:{morning|afternoon}" — stable routing key
  slotLabel: string     // "Wed 29 Apr · Morning (7–12)" — display text
  band: 'morning' | 'afternoon'
  probeStartUtc: string // ISO string of window open (UTC)
  probeEndUtc: string   // ISO string of window close (UTC)
  providers: Array<{ id: string; name: string; phone: string; score: number }>
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
