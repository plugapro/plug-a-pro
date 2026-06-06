import { db as prisma } from '../lib/db'
import {
  classifyNoMatch,
  type FailureClass,
  type NoMatchReason,
  type StageCounts,
} from '../lib/matching/diagnostics'
import type { FilteredProvider } from '../lib/matching/orchestrator'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeFilterSummary(value: unknown): FilteredProvider[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const providerId = typeof entry.providerId === 'string' ? entry.providerId : null
    const providerName = typeof entry.providerName === 'string' ? entry.providerName : undefined
    const filteredReasonCodes = Array.isArray(entry.filteredReasonCodes)
      ? entry.filteredReasonCodes.filter((code): code is string => typeof code === 'string')
      : []
    if (!providerId) return []
    return [{ providerId, providerName, filteredReasonCodes }]
  })
}

function normalizeStageCounts(value: unknown, fallback: {
  consideredCount: number
  eligibleCount: number
  rankedCount: number
}): StageCounts {
  if (isRecord(value)) {
    const locationCandidates =
      typeof value.locationCandidates === 'number' ? value.locationCandidates : null
    return {
      locationCandidates,
      skillCandidates:
        typeof value.skillCandidates === 'number' ? value.skillCandidates : fallback.consideredCount,
      eligibleCount:
        typeof value.eligibleCount === 'number' ? value.eligibleCount : fallback.eligibleCount,
      rankedCount:
        typeof value.rankedCount === 'number' ? value.rankedCount : fallback.rankedCount,
    }
  }

  return {
    locationCandidates: fallback.consideredCount > 0 ? fallback.consideredCount : null,
    skillCandidates: fallback.consideredCount,
    eligibleCount: fallback.eligibleCount,
    rankedCount: fallback.rankedCount,
  }
}

function reservationFailureReasons(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    return typeof entry.reservationFailureReason === 'string'
      ? [entry.reservationFailureReason]
      : []
  })
}

async function main() {
  const commit = process.argv.includes('--commit')

  const decisions = await prisma.dispatchDecision.findMany({
    where: {
      status: 'NO_MATCH',
      failureClass: null,
    },
    select: {
      id: true,
      consideredCount: true,
      eligibleCount: true,
      rankingSummary: true,
      filterSummary: true,
      noMatchReason: true,
      stageCounts: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const counts: Record<FailureClass, number> = {
    EMPTY_POOL: 0,
    STRUCTURAL: 0,
    TRANSIENT: 0,
  }
  let updated = 0

  for (const decision of decisions) {
    const filteredOut = normalizeFilterSummary(decision.filterSummary)
    const rankedCount = Array.isArray(decision.rankingSummary)
      ? decision.rankingSummary.length
      : decision.eligibleCount
    const stageCounts = normalizeStageCounts(decision.stageCounts, {
      consideredCount: decision.consideredCount,
      eligibleCount: decision.eligibleCount,
      rankedCount,
    })
    const reservationFailures = reservationFailureReasons(decision.rankingSummary)
    const classification = classifyNoMatch({
      consideredCount: decision.consideredCount,
      eligibleCount: decision.eligibleCount,
      rankedCount,
      filteredOut,
      nearMissCount: 0,
      reservationFailureReasons: reservationFailures,
      noMatchReason: decision.noMatchReason as NoMatchReason | null,
      stageCounts,
    })

    counts[classification.failureClass]++

    if (commit) {
      await prisma.dispatchDecision.update({
        where: { id: decision.id },
        data: {
          failureClass: classification.failureClass,
          primaryReason: classification.primaryReason,
        },
      })
      updated++
    }
  }

  console.log(JSON.stringify({
    mode: commit ? 'commit' : 'dry-run',
    scanned: decisions.length,
    updated,
    counts,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
