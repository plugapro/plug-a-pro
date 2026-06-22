// ─── Provider Profile Coach Agent — loader + artifact persistence ────────────

import { Prisma, type PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import type { Evaluation } from '../../types'
import { extractProfileScores, type ProfileCandidate } from './evaluator'

export interface LoadArgs {
  nowIso: string
  windowFromIso?: string | null
  windowToIso?: string | null
}

/**
 * Max coaching DRAFTS generated per run. Recommendations are produced for every
 * provider with gaps (cheap internal signal), but drafts — the thing ops has to
 * approve — are capped to the highest-impact (least complete) providers so the
 * approval queue stays a manageable, ranked batch instead of one-per-provider.
 */
export const DRAFT_BUDGET_PER_RUN = 25

/** Cheap completeness proxy used only to RANK who most needs a nudge (0–7 present). */
function presentFieldCount(p: ProfileCandidate): number {
  return (
    (p.hasBio ? 1 : 0) +
    (p.hasAvatar ? 1 : 0) +
    (p.hasExperience ? 1 : 0) +
    (p.portfolioCount > 0 ? 1 : 0) +
    (p.skillsCount > 0 ? 1 : 0) +
    (p.serviceAreasCount > 0 ? 1 : 0) +
    (p.equipmentCount > 0 ? 1 : 0)
  )
}

export async function loadProfileCandidates(_args: LoadArgs): Promise<ProfileCandidate[]> {
  const providers = await db.provider.findMany({
    where: { active: true, isTestUser: false },
    select: {
      id: true,
      phone: true,
      firstName: true,
      bio: true,
      avatarUrl: true,
      skills: true,
      serviceAreas: true,
      experience: true,
      portfolioUrls: true,
      equipmentTags: true,
      verified: true,
      kycStatus: true,
      payoutVerifiedAt: true,
      averageRating: true,
      completedJobsCount: true,
      reliabilityScore: true,
      acceptanceRate: true,
      complaintRate: true,
      whatsappMarketingOptIn: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  })

  const candidates = providers.map((p): ProfileCandidate => ({
    id: p.id,
    phone: p.phone ?? null,
    firstName: p.firstName ?? null,
    hasBio: Boolean(p.bio && p.bio.trim()),
    hasAvatar: Boolean(p.avatarUrl),
    skillsCount: p.skills.length,
    serviceAreasCount: p.serviceAreas.length,
    hasExperience: Boolean(p.experience && p.experience.trim()),
    portfolioCount: p.portfolioUrls.length,
    equipmentCount: p.equipmentTags.length,
    verified: p.verified,
    kycVerified: p.kycStatus === 'VERIFIED',
    payoutVerified: p.payoutVerifiedAt != null,
    averageRating: p.averageRating,
    completedJobsCount: p.completedJobsCount,
    reliabilityScore: p.reliabilityScore,
    acceptanceRate: p.acceptanceRate,
    complaintRate: p.complaintRate,
    whatsappMarketingOptIn: p.whatsappMarketingOptIn,
    draftEligible: false,
  }))

  // Cap drafts to the DRAFT_BUDGET_PER_RUN least-complete reachable providers.
  // Rank only those who could receive a draft (reachable + opted-in), least
  // complete first, and mark the top slice eligible; everyone else is
  // recommendation-only.
  candidates
    .filter((c) => c.phone && c.whatsappMarketingOptIn)
    .sort((a, b) => presentFieldCount(a) - presentFieldCount(b))
    .slice(0, DRAFT_BUDGET_PER_RUN)
    .forEach((c) => {
      c.draftEligible = true
    })

  return candidates
}

/** Persist a ProviderProfileScore snapshot for the coached provider. Best-effort. */
export async function persistProfileScore(
  evaluation: Evaluation,
  client: PrismaClient | Prisma.TransactionClient = db,
): Promise<void> {
  const scores = extractProfileScores(evaluation.signals)
  const missingItems = evaluation.signals
    .filter((s) => s.code.startsWith('missing_'))
    .map((s) => s.label)

  await client.providerProfileScore.create({
    data: {
      providerId: evaluation.entityId,
      attractiveness: scores.attractiveness,
      signals: [
        { code: 'completeness', value: scores.completeness },
        { code: 'trust', value: scores.trust },
        { code: 'attractiveness', value: scores.attractiveness },
      ] as Prisma.InputJsonValue,
      missingItems: missingItems as Prisma.InputJsonValue,
    },
  })
}
