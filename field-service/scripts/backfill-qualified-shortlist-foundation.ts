/**
 * Backfill the Qualified Shortlist foundation fields that were intentionally
 * left as a dry-run note in step 017.
 *
 * Covers:
 * 1) JobRequest.requestRef
 * 2) Lead.matchScore + Lead.rankingPosition
 * 3) ProviderCategory rows from Provider.skills + TechnicianSkill
 *
 * Usage:
 *   pnpm tsx scripts/backfill-qualified-shortlist-foundation.ts          # dry run
 *   pnpm tsx scripts/backfill-qualified-shortlist-foundation.ts --commit # apply
 */

import { PrismaClient } from '@prisma/client'
import { resolveServiceCategoryTag } from '../lib/service-categories'

const prisma = new PrismaClient()
const COMMIT = process.argv.includes('--commit')

function normalizeCategorySlug(input: string) {
  return resolveServiceCategoryTag(input) ?? input.trim().toLowerCase().replace(/\s+/g, '_')
}

function requestRefFromId(id: string) {
  const alnum = id.replace(/[^a-z0-9]/gi, '').toUpperCase()
  const suffix = (alnum.slice(-8) || 'REQUEST01').padStart(8, '0')
  return `PAP-${suffix}`
}

function deriveSkillLevel(yearsExperience: number | null) {
  if (yearsExperience == null || Number.isNaN(yearsExperience)) return null
  if (yearsExperience >= 10) return 'EXPERT'
  if (yearsExperience >= 5) return 'ADVANCED'
  if (yearsExperience >= 2) return 'INTERMEDIATE'
  return 'BEGINNER'
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size))
  }
  return output
}

async function backfillRequestRefs() {
  const existingRefs = await prisma.jobRequest.findMany({
    where: { requestRef: { not: null } },
    select: { requestRef: true },
  })
  const used = new Set(
    existingRefs
      .map((row) => row.requestRef?.trim())
      .filter((row): row is string => Boolean(row)),
  )

  const jobsMissingRef = await prisma.jobRequest.findMany({
    where: {
      OR: [
        { requestRef: null },
        { requestRef: '' },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  const updates: Array<{ id: string; requestRef: string }> = []
  for (const job of jobsMissingRef) {
    let candidate = requestRefFromId(job.id)
    let suffixCounter = 1
    while (used.has(candidate)) {
      const serial = suffixCounter.toString().padStart(2, '0')
      const seed = job.id.replace(/[^a-z0-9]/gi, '').toUpperCase()
      candidate = `PAP-${(seed.slice(-6) + serial).slice(0, 8)}`
      suffixCounter += 1
    }
    used.add(candidate)
    updates.push({ id: job.id, requestRef: candidate })
  }

  if (COMMIT && updates.length > 0) {
    for (const group of chunk(updates, 200)) {
      await prisma.$transaction(
        group.map((row) =>
          prisma.jobRequest.update({
            where: { id: row.id },
            data: { requestRef: row.requestRef },
          }),
        ),
      )
    }
  }

  return {
    candidates: jobsMissingRef.length,
    updated: updates.length,
  }
}

async function backfillLeadScoreAndRanking() {
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { matchScore: null },
        { rankingPosition: null },
      ],
    },
    select: {
      id: true,
      jobRequestId: true,
      providerId: true,
      matchAttemptId: true,
      matchScore: true,
      rankingPosition: true,
    },
    orderBy: { sentAt: 'asc' },
  })

  const matchAttemptIds = Array.from(
    new Set(
      leads
        .map((lead) => lead.matchAttemptId)
        .filter((id): id is string => Boolean(id)),
    ),
  )
  const attemptsById = new Map<string, { score: number | null; rankedPosition: number | null }>()
  if (matchAttemptIds.length > 0) {
    const attempts = await prisma.matchAttempt.findMany({
      where: { id: { in: matchAttemptIds } },
      select: { id: true, score: true, rankedPosition: true },
    })
    for (const attempt of attempts) {
      attemptsById.set(attempt.id, { score: attempt.score, rankedPosition: attempt.rankedPosition })
    }
  }

  const updates: Array<{ id: string; matchScore?: number; rankingPosition?: number }> = []
  let unresolved = 0

  for (const lead of leads) {
    let matchScore = lead.matchScore
    let rankingPosition = lead.rankingPosition
    let attemptData =
      lead.matchAttemptId != null
        ? attemptsById.get(lead.matchAttemptId) ?? null
        : null

    if (!attemptData) {
      const fallback = await prisma.matchAttempt.findFirst({
        where: {
          jobRequestId: lead.jobRequestId,
          providerId: lead.providerId,
        },
        orderBy: [
          { createdAt: 'asc' },
        ],
        select: { score: true, rankedPosition: true },
      })
      if (fallback) {
        attemptData = { score: fallback.score, rankedPosition: fallback.rankedPosition }
      }
    }

    if (!attemptData) {
      unresolved += 1
      continue
    }

    if (matchScore == null && attemptData.score != null) {
      matchScore = attemptData.score
    }
    if (rankingPosition == null && attemptData.rankedPosition != null) {
      rankingPosition = attemptData.rankedPosition
    }

    const patch: { id: string; matchScore?: number; rankingPosition?: number } = { id: lead.id }
    if (lead.matchScore == null && matchScore != null) patch.matchScore = matchScore
    if (lead.rankingPosition == null && rankingPosition != null) patch.rankingPosition = rankingPosition

    if (patch.matchScore != null || patch.rankingPosition != null) {
      updates.push(patch)
    } else {
      unresolved += 1
    }
  }

  if (COMMIT && updates.length > 0) {
    for (const group of chunk(updates, 200)) {
      await prisma.$transaction(
        group.map((row) =>
          prisma.lead.update({
            where: { id: row.id },
            data: {
              ...(row.matchScore != null ? { matchScore: row.matchScore } : {}),
              ...(row.rankingPosition != null ? { rankingPosition: row.rankingPosition } : {}),
            },
          }),
        ),
      )
    }
  }

  return {
    candidates: leads.length,
    updated: updates.length,
    unresolved,
  }
}

async function backfillProviderCategories() {
  const [providers, technicianSkills, existingRows] = await Promise.all([
    prisma.provider.findMany({
      select: {
        id: true,
        skills: true,
        verified: true,
        status: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.technicianSkill.findMany({
      where: { active: true },
      select: { providerId: true, skillTag: true, yearsExperience: true },
    }),
    prisma.providerCategory.findMany({
      select: { providerId: true, categorySlug: true },
    }),
  ])

  const existing = new Set(existingRows.map((row) => `${row.providerId}:${row.categorySlug}`))
  const skillsByProvider = new Map<string, Array<{ skillTag: string; yearsExperience: number | null }>>()
  for (const row of technicianSkills) {
    const list = skillsByProvider.get(row.providerId) ?? []
    list.push({ skillTag: row.skillTag, yearsExperience: row.yearsExperience ?? null })
    skillsByProvider.set(row.providerId, list)
  }

  const creates: Array<{
    providerId: string
    categorySlug: string
    yearsExperience: number | null
    skillLevel: string | null
    approvalStatus: string
  }> = []

  for (const provider of providers) {
    const mergedSkillInputs = new Set<string>()
    for (const skill of provider.skills) mergedSkillInputs.add(skill)
    for (const skill of skillsByProvider.get(provider.id) ?? []) mergedSkillInputs.add(skill.skillTag)

    for (const rawSkill of mergedSkillInputs) {
      const slug = normalizeCategorySlug(rawSkill)
      if (!slug || slug === 'other') continue
      const key = `${provider.id}:${slug}`
      if (existing.has(key)) continue

      const matchingTechSkills = (skillsByProvider.get(provider.id) ?? []).filter(
        (entry) => normalizeCategorySlug(entry.skillTag) === slug,
      )
      const maxYears = matchingTechSkills.reduce<number | null>((acc, row) => {
        if (row.yearsExperience == null) return acc
        if (acc == null) return row.yearsExperience
        return Math.max(acc, row.yearsExperience)
      }, null)

      creates.push({
        providerId: provider.id,
        categorySlug: slug,
        yearsExperience: maxYears,
        skillLevel: deriveSkillLevel(maxYears),
        approvalStatus: provider.verified && provider.status === 'ACTIVE' ? 'APPROVED' : 'PENDING_REVIEW',
      })
      existing.add(key)
    }
  }

  if (COMMIT && creates.length > 0) {
    for (const group of chunk(creates, 200)) {
      await prisma.providerCategory.createMany({
        data: group,
        skipDuplicates: true,
      })
    }
  }

  return {
    candidates: providers.length,
    created: creates.length,
  }
}

async function main() {
  console.log(COMMIT ? '[commit] qualified-shortlist-foundation backfill' : '[dry-run] qualified-shortlist-foundation backfill')

  const requestRef = await backfillRequestRefs()
  const leadScore = await backfillLeadScoreAndRanking()
  const providerCategory = await backfillProviderCategories()

  const summary = {
    mode: COMMIT ? 'commit' : 'dry-run',
    requestRef,
    leadScore,
    providerCategory,
    checkedAt: new Date().toISOString(),
  }

  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
