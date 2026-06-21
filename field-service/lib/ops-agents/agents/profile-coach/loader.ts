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

  return providers.map((p): ProfileCandidate => ({
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
  }))
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
