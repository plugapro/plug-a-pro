import type {
  AssignmentHoldStatus,
  AssignmentMode,
  BookingStatus,
  DispatchDecisionStatus,
  MatchAttemptStage,
  Prisma,
} from '@prisma/client'
import { db } from '../db'
import { MATCHING_CONFIG, type MatchingWeights } from './config'
import { buildWorkingWindow, deriveRequestWindow, evaluateScheduleFit, normalizeCommitments } from './scheduling'
import type {
  DispatchActor,
  DispatchHistoryResult,
  DispatchRunResult,
  MatchingAddress,
  MatchingJobRequest,
  MatchingProvider,
  OfferResolutionResult,
  RankedCandidate,
  RankingResult,
  ScoreBreakdown,
} from './types'

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase()
}

function getReliabilityScore(provider: MatchingProvider) {
  if (provider.completedJobsCount === 0) {
    return provider.reliabilityScore || 0.5
  }

  return Math.min(
    1,
    Math.max(
      0,
      provider.reliabilityScore * 0.5 +
        provider.onTimeRate * 0.25 +
        provider.acceptanceRate * 0.15 +
        Math.min(provider.averageRating / 5, 1) * 0.1,
    ),
  )
}

function hasRequiredSkills(jobRequest: MatchingJobRequest, provider: MatchingProvider) {
  const requiredSkills = new Set(
    (jobRequest.requiredSkillTags.length > 0
      ? jobRequest.requiredSkillTags
      : [jobRequest.category]
    ).map(normalizeTag),
  )

  const providerSkills = new Set(
    [
      ...provider.skills,
      ...provider.technicianSkills.map((skill) => skill.skillTag),
    ].map(normalizeTag),
  )

  return [...requiredSkills].every((skill) => providerSkills.has(skill))
}

function hasRequiredCertifications(jobRequest: MatchingJobRequest, provider: MatchingProvider) {
  if (jobRequest.requiredCertificationCodes.length === 0) return true

  const activeCertifications = new Set(
    provider.technicianCertifications
      .filter((cert) => cert.status !== 'EXPIRED')
      .map((cert) => normalizeTag(cert.certificationCode)),
  )

  return jobRequest.requiredCertificationCodes
    .map(normalizeTag)
    .every((code) => activeCertifications.has(code))
}

function providerCoversAddress(provider: MatchingProvider, address: MatchingAddress) {
  const addressTerms = [
    address.suburb,
    address.city,
  ].map((value) => normalizeTag(value ?? '')).filter(Boolean)

  const serviceAreas = new Set(
    [
      ...provider.serviceAreas,
      ...provider.technicianServiceAreas.filter((area) => area.active).map((area) => area.label),
      ...provider.technicianServiceAreas
        .filter((area) => area.active && area.city)
        .map((area) => area.city as string),
    ].map(normalizeTag),
  )

  return addressTerms.some((term) => serviceAreas.has(term))
}

function buildScoreBreakdown(params: {
  jobRequest: MatchingJobRequest
  provider: MatchingProvider
  scheduleFitScore: number
  travelMinutes: number
  canMeetWindow: boolean
  weights?: MatchingWeights
}) {
  const weights = params.weights ?? MATCHING_CONFIG.weights
  const skillMatch = hasRequiredSkills(params.jobRequest, params.provider) ? 1 : 0
  const scheduleFit = params.scheduleFitScore
  const travelEfficiency = Math.max(
    0,
    1 - params.travelMinutes / Math.max(params.provider.maxTravelMinutes, 1),
  )
  const reliability = getReliabilityScore(params.provider)
  const customerPreference =
    params.jobRequest.preferredProviderId === params.provider.id ? 1 : 0
  const marginEfficiency = Math.max(
    0,
    Math.min(1, (params.provider.maxTravelMinutes - params.travelMinutes) / Math.max(params.provider.maxTravelMinutes, 1)),
  )

  const total =
    skillMatch * weights.skillMatch +
    scheduleFit * weights.scheduleFit +
    travelEfficiency * weights.travelEfficiency +
    reliability * weights.reliability +
    customerPreference * weights.customerPreference +
    marginEfficiency * weights.marginEfficiency

  const reasons = [
    skillMatch === 1 ? 'Required skills matched' : 'Missing required skill coverage',
    params.canMeetWindow ? 'Can meet requested arrival window' : 'Window fit is weaker',
    `Estimated travel ${params.travelMinutes} minutes`,
    `Reliability score ${reliability.toFixed(2)}`,
  ]

  if (customerPreference > 0) {
    reasons.push('Preferred or repeat technician')
  }

  return {
    skillMatch,
    scheduleFit,
    travelEfficiency,
    reliability,
    customerPreference,
    marginEfficiency,
    total,
    reasons,
  } satisfies ScoreBreakdown
}

async function loadMatchingContext(jobRequestId: string) {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    include: {
      address: true,
      customer: true,
    },
  })

  if (!jobRequest || !jobRequest.address) {
    throw new Error('JOB_REQUEST_NOT_FOUND')
  }

  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
    },
    include: {
      technicianSkills: true,
      technicianCertifications: true,
      technicianServiceAreas: true,
      technicianAvailability: true,
      schedule: { where: { active: true } },
      scheduleItems: {
        where: {
          status: 'ACTIVE',
          endAt: {
            gte: new Date(
              (jobRequest.requestedWindowStart ?? new Date()).getTime() -
                24 * 60 * 60 * 1000,
            ),
          },
        },
      },
      matches: {
        where: {
          jobRequest: {
            customerId: jobRequest.customerId,
          },
        },
        select: {
          providerId: true,
        },
        take: 5,
      },
      jobs: {
        where: {
          status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'] },
        },
        include: {
          booking: true,
        },
      },
    },
  })

  return {
    jobRequest: jobRequest as MatchingJobRequest & {
      address: MatchingAddress
      customer: { id: string; name: string; phone: string }
    },
    providers: providers as (MatchingProvider & {
      schedule: { dayOfWeek: number; startTime: string; endTime: string; active: boolean }[]
      matches: { providerId: string }[]
      jobs: { booking: { id: string; scheduledDate: Date; scheduledStartAt: Date | null; scheduledEndAt: Date | null; scheduledWindow: string | null; status: string } | null }[]
    })[],
  }
}

export async function rankCandidatesForJobRequest(jobRequestId: string): Promise<RankingResult> {
  const { jobRequest, providers } = await loadMatchingContext(jobRequestId)
  const address = jobRequest.address
  const filteredOut: RankingResult['filteredOut'] = []
  const candidates: RankedCandidate[] = []
  const requestWindow = deriveRequestWindow(jobRequest)

  for (const provider of providers) {
    const filteredReasonCodes: string[] = []

    if (!provider.active) filteredReasonCodes.push('TECHNICIAN_INACTIVE')
    if (!provider.availableNow) filteredReasonCodes.push('TECHNICIAN_NOT_AVAILABLE_NOW')
    if (provider.technicianAvailability?.availabilityState === 'OFFLINE') {
      filteredReasonCodes.push('TECHNICIAN_OFFLINE')
    }
    if (!providerCoversAddress(provider, address)) {
      filteredReasonCodes.push('OUTSIDE_SERVICE_AREA')
    }
    if (!hasRequiredSkills(jobRequest, provider)) {
      filteredReasonCodes.push('MISSING_REQUIRED_SKILL')
    }
    if (!hasRequiredCertifications(jobRequest, provider)) {
      filteredReasonCodes.push('MISSING_REQUIRED_CERTIFICATION')
    }

    const scheduleRule =
      provider.schedule.find((rule) => rule.dayOfWeek === requestWindow.startAt.getDay()) ?? null

    const workingWindow = buildWorkingWindow({
      requestStartAt: requestWindow.startAt,
      schedule: scheduleRule,
    })

    const commitments = normalizeCommitments({
      bookings: provider.jobs
        .map((job) => job.booking)
        .filter((booking): booking is NonNullable<typeof booking> => Boolean(booking))
        .map((booking) => ({
          ...booking,
          status: booking.status as BookingStatus,
        })),
      scheduleItems: provider.scheduleItems,
    })

    const scheduleFit = evaluateScheduleFit({
      jobRequest,
      requestAddress: address,
      workingWindow,
      technicianAvailability: provider.technicianAvailability,
      commitments,
      technicianOrigin: {
        suburb: provider.technicianServiceAreas.find((area) => area.active)?.label ??
          provider.serviceAreas[0] ??
          null,
        city: provider.technicianServiceAreas.find((area) => area.city)?.city ?? address.city,
        lat: provider.lastKnownLat,
        lng: provider.lastKnownLng,
      },
      maxTravelMinutes: provider.maxTravelMinutes,
    })

    if (!scheduleFit.isAvailable) {
      filteredReasonCodes.push(
        scheduleFit.canMeetWindow ? 'SCHEDULE_CONFLICT' : 'WINDOW_NOT_FEASIBLE',
      )
    }

    if (filteredReasonCodes.length > 0) {
      filteredOut.push({
        providerId: provider.id,
        providerName: provider.name,
        filteredReasonCodes,
      })
      continue
    }

    const scoreBreakdown = buildScoreBreakdown({
      jobRequest,
      provider,
      scheduleFitScore: scheduleFit.score,
      travelMinutes: scheduleFit.travelMinutes,
      canMeetWindow: scheduleFit.canMeetWindow,
    })

    candidates.push({
      providerId: provider.id,
      providerName: provider.name,
      score: scoreBreakdown.total,
      scoreBreakdown,
      filteredReasonCodes,
      feasibilityNotes: scheduleFit.notes,
      travelMinutes: scheduleFit.travelMinutes,
      availabilityState:
        provider.technicianAvailability?.availabilityState ??
        (provider.availableNow ? 'AVAILABLE' : 'PAUSED'),
      canMeetWindow: scheduleFit.canMeetWindow,
      estimatedStartAt: scheduleFit.estimatedStartAt,
      estimatedEndAt: scheduleFit.estimatedEndAt,
      reliabilityIndicators: {
        reliabilityScore: provider.reliabilityScore,
        averageRating: provider.averageRating,
        completedJobsCount: provider.completedJobsCount,
        onTimeRate: provider.onTimeRate,
        acceptanceRate: provider.acceptanceRate,
      },
      selectionReason: scoreBreakdown.reasons[0] ?? 'Best overall operational fit',
    })
  }

  candidates.sort((a, b) => b.score - a.score || a.travelMinutes - b.travelMinutes)

  return {
    jobRequestId,
    assignmentMode: jobRequest.assignmentMode,
    consideredCount: providers.length,
    eligibleCount: candidates.length,
    filteredOut,
    candidates,
  }
}

async function persistDispatchDecision(params: {
  ranking: RankingResult
  actor: DispatchActor
  mode: AssignmentMode | 'MANUAL_OVERRIDE'
  overrideProviderId?: string
  overrideReason?: string | null
}) {
  const decisionMode =
    params.mode === 'MANUAL_OVERRIDE' ? 'MANUAL_OVERRIDE' : params.mode
  const status =
    params.ranking.candidates.length === 0 ? 'NO_MATCH' : params.mode === 'OPS_REVIEW' ? 'RANKED' : 'OFFERING'

  const rankingSummary = params.ranking.candidates.map((candidate, index) => ({
    providerId: candidate.providerId,
    score: candidate.score,
    rankedPosition: index + 1,
    selectionReason: candidate.selectionReason,
    travelMinutes: candidate.travelMinutes,
    canMeetWindow: candidate.canMeetWindow,
  }))

  const filterSummary = params.ranking.filteredOut

  const decision = await db.dispatchDecision.create({
    data: {
      jobRequestId: params.ranking.jobRequestId,
      mode: decisionMode,
      status,
      initiatedById: params.actor.actorId,
      initiatedByRole: params.actor.actorRole,
      selectedProviderId: params.overrideProviderId,
      overrideReason: params.overrideReason ?? undefined,
      consideredCount: params.ranking.consideredCount,
      eligibleCount: params.ranking.eligibleCount,
      scoreWeights: MATCHING_CONFIG.weights as Prisma.InputJsonValue,
      rankingSummary: rankingSummary as Prisma.InputJsonValue,
      filterSummary: filterSummary as Prisma.InputJsonValue,
      explanation:
        params.ranking.candidates[0]?.selectionReason ??
        'No eligible technicians passed the matching filters',
    },
  })

  for (const [index, candidate] of params.ranking.candidates.entries()) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: params.ranking.jobRequestId,
        providerId: candidate.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: index + 1,
        rankedPosition: index + 1,
        stage: 'RANKED',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: candidate.feasibilityNotes,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown as Prisma.InputJsonValue,
      },
    })
  }

  for (const filtered of params.ranking.filteredOut) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: params.ranking.jobRequestId,
        providerId: filtered.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: 0,
        stage: 'FILTERED_OUT',
        hardFilterPassed: false,
        filteredReasonCodes: filtered.filteredReasonCodes,
        feasibilityNotes: [],
      },
    })
  }

  await db.jobRequest.update({
    where: { id: params.ranking.jobRequestId },
    data: {
      latestDispatchDecisionId: decision.id,
      assignmentMode: params.mode === 'MANUAL_OVERRIDE' ? 'OPS_REVIEW' : params.mode,
      status: params.ranking.candidates.length > 0 ? 'MATCHING' : 'OPEN',
    },
  })

  return decision
}

async function createOfferForAttempt(params: {
  dispatchDecisionId: string
  jobRequestId: string
  matchAttemptId: string
  providerId: string
  actor: DispatchActor
}) {
  const expiresAt = new Date(Date.now() + MATCHING_CONFIG.offerTtlMinutes * 60_000)

  await db.assignmentHold.updateMany({
    where: {
      jobRequestId: params.jobRequestId,
      status: 'ACTIVE',
    },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
      outcomeReasonCode: 'SUPERSEDED_BY_NEW_OFFER',
    },
  })

  await db.technicianScheduleItem.updateMany({
    where: {
      jobRequestId: params.jobRequestId,
      itemType: 'ASSIGNMENT_HOLD',
      status: 'ACTIVE',
    },
    data: {
      status: 'RELEASED',
      updatedAt: new Date(),
    },
  })

  const hold = await db.assignmentHold.create({
    data: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      status: 'ACTIVE',
      expiresAt,
    },
  })

  const jobRequest = await db.jobRequest.findUniqueOrThrow({
    where: { id: params.jobRequestId },
    include: {
      address: true,
      customer: { select: { name: true } },
    },
  })

  const lead = await db.lead.upsert({
    where: {
      jobRequestId_providerId: {
        jobRequestId: params.jobRequestId,
        providerId: params.providerId,
      },
    },
    create: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      assignmentHoldId: hold.id,
      status: 'SENT',
      expiresAt,
    },
    update: {
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: new Date(),
      respondedAt: null,
      expiresAt,
    },
  })

  await db.matchAttempt.update({
    where: { id: params.matchAttemptId },
    data: {
      stage: 'OFFERED',
      offeredAt: new Date(),
      reasonCode: 'TOP_RANKED_ACTIVE_OFFER',
    },
  })

  await db.dispatchDecision.update({
    where: { id: params.dispatchDecisionId },
    data: {
      status: 'OFFERING',
      selectedProviderId: params.providerId,
      selectedMatchAttemptId: params.matchAttemptId,
    },
  })

  const requestWindow = deriveRequestWindow(jobRequest)
  await db.technicianScheduleItem.create({
    data: {
      providerId: params.providerId,
      jobRequestId: params.jobRequestId,
      assignmentHoldId: hold.id,
      itemType: 'ASSIGNMENT_HOLD',
      status: 'ACTIVE',
      title: `${jobRequest.category} offer hold`,
      startAt: requestWindow.startAt,
      endAt: requestWindow.endAt,
      source: 'matching_engine',
      locationLabel: [jobRequest.address?.suburb, jobRequest.address?.city].filter(Boolean).join(', '),
      lat: jobRequest.address?.lat ?? undefined,
      lng: jobRequest.address?.lng ?? undefined,
    },
  })

  const provider = await db.provider.findUniqueOrThrow({
    where: { id: params.providerId },
  })

  const { notifyProviderNewJob } = await import('../whatsapp-bot')
  await notifyProviderNewJob({
    providerPhone: provider.phone,
    leadId: lead.id,
    category: jobRequest.category,
    area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
    description: jobRequest.title || jobRequest.description || jobRequest.category,
    customerInitial: (jobRequest.customer?.name ?? 'Customer').split(' ')[0] ?? 'Customer',
    expiresInMinutes: MATCHING_CONFIG.offerTtlMinutes,
  }).catch((error) => {
    console.error('[matching] Failed to notify provider of assignment offer:', error)
  })

  // Template fallback — delivers even when provider is outside the 24h interactive session window.
  // The interactive message above is preferred (richer UX); this ensures delivery for out-of-session providers.
  const { sendJobOffer } = await import('../whatsapp')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const scheduledWindow = requestWindow.startAt.toLocaleDateString('en-ZA', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  sendJobOffer({
    providerPhone: provider.phone,
    providerFirstName: provider.name.split(' ')[0] ?? provider.name,
    serviceName: jobRequest.category,
    area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
    scheduledWindow,
    jobUrl: `${appUrl}/provider/jobs/${lead.id}`,
  }).catch((error) => {
    console.error('[matching] Failed to send job_offer template to provider:', error)
  })

  return { hold, lead }
}

export async function runAssignmentForJobRequest(params: {
  jobRequestId: string
  actor?: DispatchActor
  mode?: AssignmentMode
}) : Promise<DispatchRunResult> {
  const actor = params.actor ?? { actorId: 'system', actorRole: 'system' as const }
  const ranking = await rankCandidatesForJobRequest(params.jobRequestId)
  const mode = params.mode ?? ranking.assignmentMode
  const dispatchDecision = await persistDispatchDecision({
    ranking,
    actor,
    mode,
  })

  if (mode === 'OPS_REVIEW' || ranking.candidates.length === 0) {
    return {
      ...ranking,
      dispatchDecisionId: dispatchDecision.id,
      status: dispatchDecision.status,
      offeredProviderId: null,
      assignmentHoldId: null,
    }
  }

  const topCandidate = ranking.candidates[0]
  const topAttempt = await db.matchAttempt.findFirstOrThrow({
    where: {
      dispatchDecisionId: dispatchDecision.id,
      providerId: topCandidate.providerId,
    },
  })
  const offer = await createOfferForAttempt({
    dispatchDecisionId: dispatchDecision.id,
    jobRequestId: ranking.jobRequestId,
    matchAttemptId: topAttempt.id,
    providerId: topCandidate.providerId,
    actor,
  })

  return {
    ...ranking,
    dispatchDecisionId: dispatchDecision.id,
    status: 'OFFERING',
    offeredProviderId: topCandidate.providerId,
    assignmentHoldId: offer.hold.id,
  }
}

async function offerNextRankedCandidate(params: {
  jobRequestId: string
  dispatchDecisionId: string
  actor?: DispatchActor
}) {
  const attempts = await db.matchAttempt.findMany({
    where: {
      dispatchDecisionId: params.dispatchDecisionId,
      hardFilterPassed: true,
    },
    orderBy: { rankedPosition: 'asc' },
  })

  const nextAttempt = attempts.find((attempt) => attempt.stage === 'RANKED')
  if (!nextAttempt) {
    await db.dispatchDecision.update({
      where: { id: params.dispatchDecisionId },
      data: { status: 'NO_MATCH' },
    })
    await db.jobRequest.update({
      where: { id: params.jobRequestId },
      data: { status: 'OPEN' },
    })
    return { nextOfferedProviderId: null, assignmentHoldId: null }
  }

  const offer = await createOfferForAttempt({
    dispatchDecisionId: params.dispatchDecisionId,
    jobRequestId: params.jobRequestId,
    matchAttemptId: nextAttempt.id,
    providerId: nextAttempt.providerId,
    actor: params.actor ?? { actorId: 'system', actorRole: 'system' },
  })

  return {
    nextOfferedProviderId: nextAttempt.providerId,
    assignmentHoldId: offer.hold.id,
  }
}

export async function acceptAssignmentOffer(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
}): Promise<OfferResolutionResult> {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: params.leadId },
      include: {
        assignmentHold: true,
        matchAttempt: true,
      },
    })

    if (!lead) return { ok: false as const, reason: 'NOT_FOUND' }
    if (lead.providerId !== params.providerId) return { ok: false as const, reason: 'FORBIDDEN' }
    if (!lead.assignmentHoldId || !lead.assignmentHold) {
      return { ok: false as const, reason: 'TAKEN' }
    }
    if (lead.assignmentHold.status !== 'ACTIVE') {
      return { ok: false as const, reason: 'TAKEN' }
    }
    if (lead.expiresAt && lead.expiresAt < new Date()) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'EXPIRED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
        },
      })
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId ?? '' },
        data: {
          stage: 'TIMED_OUT',
          respondedAt: new Date(),
          responseOutcome: 'TIMED_OUT',
          reasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
        },
      }).catch(() => {})
      return { ok: false as const, reason: 'EXPIRED' }
    }

    const existingMatch = await tx.match.findUnique({
      where: { jobRequestId: lead.jobRequestId },
    })

    if (existingMatch && existingMatch.providerId !== params.providerId) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'RELEASED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'MATCH_ALREADY_TAKEN',
        },
      })
      return { ok: false as const, reason: 'TAKEN' }
    }

    if (existingMatch && existingMatch.providerId === params.providerId) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'MATCH_ALREADY_CONFIRMED',
        },
      })

      return {
        ok: true as const,
        responseOutcome: 'ACCEPTED',
        matchId: existingMatch.id,
        assignmentHoldId: lead.assignmentHold.id,
        nextOfferedProviderId: null,
      }
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    })
    await tx.assignmentHold.update({
      where: { id: lead.assignmentHold.id },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: 'ACCEPTED',
      },
    })
    if (lead.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId },
        data: {
          stage: 'ACCEPTED',
          respondedAt: new Date(),
          responseOutcome: 'ACCEPTED',
          reasonCode: 'TECHNICIAN_ACCEPTED_OFFER',
        },
      })
    }

    const match = await tx.match.create({
      data: {
        jobRequestId: lead.jobRequestId,
        providerId: params.providerId,
        status: params.inspectionNeeded ? 'INSPECTION_SCHEDULED' : 'MATCHED',
        inspectionNeeded: params.inspectionNeeded === true,
      },
    })

    await tx.jobRequest.update({
      where: { id: lead.jobRequestId },
      data: { status: 'MATCHED' },
    })

    await tx.dispatchDecision.updateMany({
      where: {
        id: lead.dispatchDecisionId ?? undefined,
      },
      data: {
        status: 'ASSIGNED',
        selectedProviderId: params.providerId,
        selectedMatchAttemptId: lead.matchAttemptId ?? undefined,
      },
    })

    await tx.lead.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.id },
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })
    await tx.assignmentHold.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.assignmentHold.id },
        status: 'ACTIVE',
      },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        outcomeReasonCode: 'MATCH_ASSIGNED_ELSEWHERE',
      },
    })
    await tx.technicianScheduleItem.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        itemType: 'ASSIGNMENT_HOLD',
        assignmentHoldId: { not: lead.assignmentHold.id },
      },
      data: { status: 'RELEASED' },
    })

    return {
      ok: true as const,
      responseOutcome: 'ACCEPTED',
      matchId: match.id,
      assignmentHoldId: lead.assignmentHold.id,
      nextOfferedProviderId: null,
    }
  })
}

export async function rejectAssignmentOffer(params: {
  leadId: string
  providerId: string
  reasonCode?: string
}): Promise<OfferResolutionResult> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: { assignmentHold: true, matchAttempt: true },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (lead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }
  if (!lead.assignmentHold) return { ok: false, reason: 'TAKEN' }
  if (lead.assignmentHold.status !== 'ACTIVE') {
    return { ok: false, reason: 'TAKEN' }
  }

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    })
    await tx.assignmentHold.update({
      where: { id: lead.assignmentHold!.id },
      data: {
        status: 'REJECTED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: params.reasonCode ?? 'TECHNICIAN_REJECTED_OFFER',
      },
    })
    if (lead.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId },
        data: {
          stage: 'REJECTED',
          respondedAt: new Date(),
          responseOutcome: 'REJECTED',
          reasonCode: params.reasonCode ?? 'TECHNICIAN_REJECTED_OFFER',
        },
      })
    }
    await tx.technicianScheduleItem.updateMany({
      where: { assignmentHoldId: lead.assignmentHold!.id, itemType: 'ASSIGNMENT_HOLD' },
      data: { status: 'RELEASED' },
    })
  })

  const next = await offerNextRankedCandidate({
    jobRequestId: lead.jobRequestId,
    dispatchDecisionId: lead.dispatchDecisionId!,
  })

  return {
    ok: true,
    responseOutcome: 'REJECTED',
    matchId: null,
    assignmentHoldId: lead.assignmentHold.id,
    nextOfferedProviderId: next.nextOfferedProviderId,
  }
}

export async function expireAssignmentOffer(params: {
  assignmentHoldId: string
}) {
  const hold = await db.assignmentHold.findUnique({
    where: { id: params.assignmentHoldId },
    include: {
      dispatchDecision: true,
      matchAttempt: true,
      jobRequest: true,
    },
  })

  if (!hold) return { expired: false, nextOfferedProviderId: null }
  if (hold.status !== 'ACTIVE' || hold.expiresAt > new Date()) {
    return { expired: false, nextOfferedProviderId: null }
  }

  await db.$transaction(async (tx) => {
    await tx.assignmentHold.update({
      where: { id: hold.id },
      data: {
        status: 'EXPIRED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: 'OFFER_TIMEOUT',
      },
    })
    await tx.lead.updateMany({
      where: {
        assignmentHoldId: hold.id,
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })
    await tx.matchAttempt.update({
      where: { id: hold.matchAttemptId },
      data: {
        stage: 'TIMED_OUT',
        respondedAt: new Date(),
        responseOutcome: 'TIMED_OUT',
        reasonCode: 'OFFER_TIMEOUT',
      },
    })
    await tx.technicianScheduleItem.updateMany({
      where: { assignmentHoldId: hold.id, itemType: 'ASSIGNMENT_HOLD' },
      data: { status: 'RELEASED' },
    })
  })

  const next = await offerNextRankedCandidate({
    jobRequestId: hold.jobRequestId,
    dispatchDecisionId: hold.dispatchDecisionId,
  })

  return { expired: true, nextOfferedProviderId: next.nextOfferedProviderId }
}

export async function getDispatchHistory(jobRequestId: string): Promise<DispatchHistoryResult[]> {
  const dispatchDecisions = await db.dispatchDecision.findMany({
    where: { jobRequestId },
    include: {
      matchAttempts: {
        orderBy: [{ rankedPosition: 'asc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return dispatchDecisions.map((dispatchDecision) => ({
    dispatchDecision,
    attempts: dispatchDecision.matchAttempts,
  }))
}

export async function manualOverrideAssignment(params: {
  jobRequestId: string
  providerId: string
  actor: DispatchActor
  overrideReason: string
}) {
  const ranking = await rankCandidatesForJobRequest(params.jobRequestId)
  const decision = await persistDispatchDecision({
    ranking,
    actor: params.actor,
    mode: 'MANUAL_OVERRIDE',
    overrideProviderId: params.providerId,
    overrideReason: params.overrideReason,
  })

  let attempt = await db.matchAttempt.findFirst({
    where: {
      dispatchDecisionId: decision.id,
      providerId: params.providerId,
    },
  })

  if (!attempt) {
    attempt = await db.matchAttempt.create({
      data: {
        jobRequestId: params.jobRequestId,
        providerId: params.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: ranking.candidates.length + 1,
        rankedPosition: ranking.candidates.length + 1,
        stage: 'OVERRIDDEN',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: ['Selected manually by admin override'],
        score: 0,
        scoreBreakdown: {
          overridden: true,
          reason: params.overrideReason,
        } as Prisma.InputJsonValue,
        reasonCode: 'ADMIN_OVERRIDE',
      },
    })
  } else {
    await db.matchAttempt.update({
      where: { id: attempt.id },
      data: {
        stage: 'OVERRIDDEN',
        responseOutcome: 'OVERRIDDEN',
        reasonCode: 'ADMIN_OVERRIDE',
      },
    })
  }

  const offer = await createOfferForAttempt({
    dispatchDecisionId: decision.id,
    jobRequestId: params.jobRequestId,
    matchAttemptId: attempt.id,
    providerId: params.providerId,
    actor: params.actor,
  })

  await db.dispatchDecision.update({
    where: { id: decision.id },
    data: {
      status: 'OVERRIDDEN',
      selectedProviderId: params.providerId,
      selectedMatchAttemptId: attempt.id,
      overrideReason: params.overrideReason,
    },
  })

  return {
    dispatchDecisionId: decision.id,
    assignmentHoldId: offer.hold.id,
  }
}
