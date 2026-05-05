import type { Prisma } from '@prisma/client'
import { OPS_QUEUE_TYPES } from './ops-queue'

type ProviderApplicationForReview = {
  id: string
  phone: string
  name: string
  skills: string[]
  serviceAreas: string[]
  experience: string | null
  notes: string | null
}

type ProviderApplicationReviewClient = {
  providerApplication: {
    findMany: (...args: any[]) => Promise<ProviderApplicationForReview[]>
    updateMany: (...args: any[]) => Promise<{ count: number }>
  }
  opsQueueAssignment: {
    upsert: (...args: any[]) => Promise<unknown>
  }
  auditLog?: {
    create: (...args: any[]) => Promise<unknown>
  }
}

const HIGH_RISK_CATEGORY_PATTERNS = [/electrical/i, /gas/i, /security/i]

export type ProviderApplicationReviewAssessment = {
  applicationId: string
  recommendation: 'READY_FOR_OPS_REVIEW' | 'NEEDS_MORE_INFO_REVIEW' | 'HIGH_RISK_REVIEW'
  reasonCodes: string[]
}

export function assessProviderApplicationForOpsReview(
  application: ProviderApplicationForReview,
): ProviderApplicationReviewAssessment {
  const reasonCodes: string[] = []

  if (!application.name.trim()) reasonCodes.push('MISSING_NAME')
  if (application.skills.length === 0) reasonCodes.push('MISSING_SKILLS')
  if (application.serviceAreas.length === 0) reasonCodes.push('MISSING_SERVICE_AREAS')
  if (!application.experience?.trim()) reasonCodes.push('MISSING_EXPERIENCE')
  if (application.skills.some((skill) => HIGH_RISK_CATEGORY_PATTERNS.some((pattern) => pattern.test(skill)))) {
    reasonCodes.push('HIGH_RISK_CATEGORY')
  }

  const recommendation = reasonCodes.includes('HIGH_RISK_CATEGORY')
    ? 'HIGH_RISK_REVIEW'
    : reasonCodes.length > 0
      ? 'NEEDS_MORE_INFO_REVIEW'
      : 'READY_FOR_OPS_REVIEW'

  return {
    applicationId: application.id,
    recommendation,
    reasonCodes,
  }
}

function appendReviewNote(existing: string | null, assessment: ProviderApplicationReviewAssessment) {
  const marker = '[ops-review-support]'
  const line = `${marker} ${assessment.recommendation}: ${assessment.reasonCodes.length ? assessment.reasonCodes.join(', ') : 'NO_FLAGS'}`
  if (existing?.includes(marker)) return existing
  return existing ? `${existing}\n${line}` : line
}

export async function routeProviderApplicationsForOpsReview(
  client: ProviderApplicationReviewClient,
  params: { limit?: number; actorId?: string } = {},
) {
  const applications = await client.providerApplication.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      phone: true,
      name: true,
      skills: true,
      serviceAreas: true,
      experience: true,
      notes: true,
    },
    orderBy: { submittedAt: 'asc' },
    take: params.limit ?? 50,
  })

  let routed = 0
  let flagged = 0

  for (const application of applications) {
    const assessment = assessProviderApplicationForOpsReview(application)
    if (assessment.reasonCodes.length > 0) flagged += 1

    await client.opsQueueAssignment.upsert({
      where: {
        queueType_entityId: {
          queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
          entityId: application.id,
        },
      },
      create: {
        queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
        entityId: application.id,
      },
      update: {},
    })

    const nextNotes = appendReviewNote(application.notes, assessment)
    if (nextNotes !== application.notes) {
      await client.providerApplication.updateMany({
        where: { id: application.id, status: 'PENDING' },
        data: { notes: nextNotes },
      })
    }

    await client.auditLog?.create({
      data: {
        actorId: params.actorId ?? 'system',
        actorRole: 'system',
        action: 'provider_application.review_support_routed',
        entityType: 'ProviderApplication',
        entityId: application.id,
        after: assessment as unknown as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)

    routed += 1
  }

  return { routed, flagged }
}
