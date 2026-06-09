// ─── West Rand pilot — provider nudge queue ─────────────────────────────────
// Builds the ordered candidate list for /admin/nudges.
//
// Ordering (locked, see spec §5.3):
//   1. R5 with plumbing skill (highest priority — supply-critical category)
//   2. R5 (any other allowed category)
//   3. R4
//   4. PENDING_R1 (application awaiting review)
// Within each tier:
//   - oldest "last nudged at" first; null (never nudged) sorts first
//   - tiebreaker: oldest updatedAt first
//
// Last-nudged-at is derived from AdminAuditEvent rows with
// action='nudge.batch.marked_sent'. No persistent column on Provider in v1.
// If query latency becomes a concern, add Provider.lastPilotNudgeAt later
// (tracked in spec §11).

import { db } from '@/lib/db'

import {
  classifyProviderTier,
  listMissingProfileItems,
  type ProviderTier,
  type ProviderTierInput,
} from '@/lib/provider-tier'

import { buildMissingItemsLabel, renderNudgeMessage } from './template'

export const NUDGE_MARK_SENT_BATCH_CAP =
  Number(process.env.NUDGE_MARK_SENT_BATCH_CAP ?? 200) || 200

export type NudgeCandidate = {
  providerId: string
  name: string | null
  phone: string | null
  email: string | null
  tier: ProviderTier
  skills: string[]
  serviceAreas: string[]
  missingItems: string[]
  missingItemsLabel: string
  renderedMessage: string
  lastNudgedAt: Date | null
  applicationStatus: ProviderTierInput['applicationStatus']
}

type ProviderRow = ProviderTierInput & {
  id: string
  updatedAt: Date
  identityVerifications?: Array<{ assuranceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null }>
  applications?: Array<{ status: ProviderTierInput['applicationStatus'] }>
}

function toTierInput(row: ProviderRow): ProviderTierInput {
  const latestAssurance = row.identityVerifications?.[0]?.assuranceLevel ?? null
  const latestApplication = row.applications?.[0]
  return {
    verified: row.verified,
    kycStatus: row.kycStatus,
    status: row.status,
    strikes: row.strikes,
    name: row.name,
    phone: row.phone,
    email: row.email,
    payoutVerifiedAt: row.payoutVerifiedAt,
    skills: row.skills,
    equipmentTags: row.equipmentTags,
    serviceAreas: row.serviceAreas,
    identityAssurance: latestAssurance,
    hasApplication: Boolean(latestApplication),
    applicationStatus: latestApplication?.status ?? null,
  }
}

function tierRank(tier: ProviderTier, hasPlumbing: boolean): number {
  if (tier === 'R5' && hasPlumbing) return 0
  if (tier === 'R5') return 1
  if (tier === 'R4') return 2
  if (tier === 'PENDING_R1') return 3
  return 99
}

export async function listNudgeCandidates(opts: {
  suburbSlug?: string | null
  categorySlug?: string | null
  tier?: ProviderTier | null
  limit?: number | null
} = {}): Promise<NudgeCandidate[]> {
  const [providerRows, lastNudgeRows] = await Promise.all([
    db.provider.findMany({
      select: {
        id: true,
        verified: true,
        kycStatus: true,
        status: true,
        strikes: true,
        name: true,
        phone: true,
        email: true,
        payoutVerifiedAt: true,
        skills: true,
        equipmentTags: true,
        serviceAreas: true,
        updatedAt: true,
        identityVerifications: {
          select: { assuranceLevel: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        applications: {
          select: { status: true },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    }) as unknown as Promise<ProviderRow[]>,
    db.adminAuditEvent.findMany({
      where: { action: 'nudge.batch.marked_sent' },
      select: { entityId: true, timestamp: true, metadata: true },
      orderBy: { timestamp: 'desc' },
    }),
  ])

  // Index last-nudged-at by providerId. The audit metadata may reference
  // multiple providerIds per row (one batch covers many providers); the
  // entityId field also names the batch's "primary" provider. Take the most
  // recent timestamp seen for each providerId across both fields.
  const lastNudgedByProvider = new Map<string, Date>()
  for (const ev of lastNudgeRows) {
    const candidates: string[] = []
    if (ev.entityId) candidates.push(ev.entityId)
    const md = ev.metadata as any
    if (md && Array.isArray(md.providerIds)) {
      for (const id of md.providerIds) {
        if (typeof id === 'string') candidates.push(id)
      }
    }
    for (const providerId of candidates) {
      const existing = lastNudgedByProvider.get(providerId)
      if (!existing || ev.timestamp > existing) {
        lastNudgedByProvider.set(providerId, ev.timestamp)
      }
    }
  }

  const candidates: NudgeCandidate[] = []
  for (const row of providerRows) {
    const input = toTierInput(row)
    const tier = classifyProviderTier(input)
    if (!tier) continue
    if (opts.tier && tier !== opts.tier) continue
    if (opts.suburbSlug && !row.serviceAreas.includes(opts.suburbSlug)) continue
    if (opts.categorySlug && !row.skills.includes(opts.categorySlug)) continue

    const missingItems = listMissingProfileItems(input)
    if (missingItems.length === 0) continue

    const firstName = (row.name ?? '').split(' ')[0] ?? ''
    const missingItemsLabel = buildMissingItemsLabel(missingItems)
    candidates.push({
      providerId: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      tier,
      skills: row.skills,
      serviceAreas: row.serviceAreas,
      missingItems,
      missingItemsLabel,
      renderedMessage: renderNudgeMessage({ firstName, missingItemsLabel }),
      lastNudgedAt: lastNudgedByProvider.get(row.id) ?? null,
      applicationStatus: input.applicationStatus ?? null,
    })
  }

  candidates.sort((a, b) => {
    const aPlumb = a.skills.includes('plumbing')
    const bPlumb = b.skills.includes('plumbing')
    const aRank = tierRank(a.tier, aPlumb)
    const bRank = tierRank(b.tier, bPlumb)
    if (aRank !== bRank) return aRank - bRank
    // Within tier: nulls (never nudged) first, then oldest timestamp.
    if (a.lastNudgedAt == null && b.lastNudgedAt != null) return -1
    if (a.lastNudgedAt != null && b.lastNudgedAt == null) return 1
    if (a.lastNudgedAt && b.lastNudgedAt) {
      const diff = a.lastNudgedAt.getTime() - b.lastNudgedAt.getTime()
      if (diff !== 0) return diff
    }
    return 0
  })

  const limit = opts.limit ?? null
  return limit != null ? candidates.slice(0, limit) : candidates
}
