import { describe, expect, it } from 'vitest'
import { scoreAndRankCandidates } from '../../lib/matching/scoring'
import type { EligibleProvider } from '../../lib/matching/filter'
import type { MatchingJobRequest } from '../../lib/matching/types'

// Minimal EligibleProvider builder — only fills the fields scoring actually reads.
// Any unused fields are cast through `as never` so we don't drift if filter.ts grows.
function makeEligible(overrides: Partial<EligibleProvider> & { id: string; kycStatus: string | null; score?: never }): EligibleProvider {
  const base = {
    id: overrides.id,
    name: `prov-${overrides.id}`,
    phone: '+27000000000',
    skills: ['handyman'],
    serviceAreas: ['Honeydew'],
    maxTravelMinutes: 60,
    reliabilityScore: 0.8,
    averageRating: 4.5,
    active: true,
    verified: true,
    kycStatus: overrides.kycStatus,
    availableNow: true,
    lastKnownLat: null,
    lastKnownLng: null,
    isOnline: true,
    liveLocationLat: null,
    liveLocationLng: null,
    lastHeartbeatAt: null,
    scoreBase: 0.8,
    fromPool: false,
    isTestUser: false,
    cohortName: null,

    scheduleFitScore: overrides.scheduleFitScore ?? 0.8,
    travelMinutes: overrides.travelMinutes ?? 15,
    canMeetWindow: true,
    estimatedStartAt: null,
    estimatedEndAt: null,
    feasibilityNotes: [],
    coverageTier: 'SUBURB',
    availabilityState: 'AVAILABLE',
    completedJobsCount: 5,
    onTimeRate: 0.9,
    acceptanceRate: 0.7,
    complaintCount: 0,
    complaintRate: 0,
    cancellationRate: 0.05,
    punctualityScore: 0.9,
    lastKnownLocationAt: null,
    dailyAssignedJobs: 0,
    technicianSkills: [],
    technicianCertifications: [],
    technicianServiceAreas: [],
    technicianAvailability: null,
    scheduleItems: [],
    schedule: [],
    adminCertifications: [],
    equipment: [],
  } as unknown as EligibleProvider
  return { ...base, ...overrides }
}

const baseRequest: MatchingJobRequest = {
  id: 'jr1',
  category: 'handyman',
  requiredSkillTags: ['handyman'],
  requiredCertificationCodes: [],
  requiredEquipmentTags: [],
  requiredVehicleTypes: [],
  assignmentMode: 'AUTO_ASSIGN',
  preferredProviderId: null,
} as unknown as MatchingJobRequest

describe('scoreAndRankCandidates — verificationTrustTier', () => {
  it('without the flag, ranking is purely score-driven (legacy behaviour)', () => {
    const eligible = [
      makeEligible({ id: 'A', kycStatus: 'NOT_STARTED', scheduleFitScore: 0.95 }), // higher score
      makeEligible({ id: 'B', kycStatus: 'VERIFIED', scheduleFitScore: 0.50 }),    // lower score
    ]
    const ranked = scoreAndRankCandidates(eligible, baseRequest)
    expect(ranked.map((c) => c.providerId)).toEqual(['A', 'B'])
  })

  it('with the flag, VERIFIED outranks all non-verified regardless of score', () => {
    // Mirrors today's Honeydew Job #1: verified provider had a LOWER score than
    // two non-verified providers, so they were dispatched 8th and the WhatsApp
    // window expired before they ever got the lead.
    const eligible = [
      makeEligible({ id: 'A', kycStatus: 'NOT_STARTED', scheduleFitScore: 0.95 }),
      makeEligible({ id: 'B', kycStatus: 'NOT_STARTED', scheduleFitScore: 0.90 }),
      makeEligible({ id: 'C', kycStatus: 'IN_PROGRESS', scheduleFitScore: 0.85 }),
      makeEligible({ id: 'D', kycStatus: 'VERIFIED',    scheduleFitScore: 0.50 }),
    ]
    const ranked = scoreAndRankCandidates(eligible, baseRequest, { verificationTrustTier: true })
    expect(ranked.map((c) => c.providerId)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('with the flag, multiple VERIFIED providers sort among themselves by score', () => {
    const eligible = [
      makeEligible({ id: 'V_low',  kycStatus: 'VERIFIED', scheduleFitScore: 0.60 }),
      makeEligible({ id: 'NV_top', kycStatus: 'NOT_STARTED', scheduleFitScore: 0.99 }),
      makeEligible({ id: 'V_high', kycStatus: 'VERIFIED', scheduleFitScore: 0.95 }),
    ]
    const ranked = scoreAndRankCandidates(eligible, baseRequest, { verificationTrustTier: true })
    expect(ranked.map((c) => c.providerId)).toEqual(['V_high', 'V_low', 'NV_top'])
  })

  it('with the flag, null/missing kycStatus is treated as non-verified', () => {
    const eligible = [
      makeEligible({ id: 'unknown', kycStatus: null, scheduleFitScore: 0.95 }),
      makeEligible({ id: 'verified', kycStatus: 'VERIFIED', scheduleFitScore: 0.50 }),
    ]
    const ranked = scoreAndRankCandidates(eligible, baseRequest, { verificationTrustTier: true })
    expect(ranked[0].providerId).toBe('verified')
  })
})
