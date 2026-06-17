// Database queries for the Provider Quality view. Keeps the SQL in one place
// so the admin page, the report script, and the nudge orchestrator share the
// same source of truth.

import { db } from '@/lib/db'
import {
  aggregateQualityCounts,
  computeProviderQuality,
  type ProviderQualityCounts,
  type ProviderQualityInput,
  type ProviderQualitySnapshot,
  type QualityDimension,
} from './quality'

export interface QualityFilter {
  missingKyc?: boolean
  missingProfilePhoto?: boolean
  missingPortfolioEvidence?: boolean
  missingHighRiskCert?: boolean
  hasHighRiskSkill?: boolean
  notQualityReady?: boolean
  kycStartedIncomplete?: boolean
  kycFailedOrExpired?: boolean
  /** Limit + offset for paging — admin table only. */
  limit?: number
  offset?: number
}

export interface ProviderQualityRow {
  provider: {
    id: string
    name: string | null
    phone: string | null
    skills: string[]
    active: boolean
    createdAt: Date
  }
  snapshot: ProviderQualitySnapshot
  lastNudgeAt: Date | null
  lastNudgeTemplate: string | null
  nudgeCount: number
}

/**
 * Load every non-test provider with the fields needed to compute their quality
 * snapshot. One query (plus follow-ups for certifications + nudge history) —
 * the marketplace is small enough that we don't yet need pagination at the SQL
 * layer. Filter narrowing happens in-memory after the snapshot computation.
 */
export async function loadProviderQualityRows(filter: QualityFilter = {}): Promise<ProviderQualityRow[]> {
  // Hydrate the provider list with skills + photo + portfolio + KYC + cert evidence.
  const providers = await db.provider.findMany({
    where: {
      isTestUser: false,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      active: true,
      avatarUrl: true,
      portfolioUrls: true,
      kycStatus: true,
      createdAt: true,
      technicianCertifications: {
        select: {
          certificationCode: true,
          status: true,
          evidenceUrl: true,
          verifiedAt: true,
        },
      },
      adminCertifications: {
        select: {
          name: true,
          verifiedAt: true,
          documentUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const providerIds = providers.map((p) => p.id)
  const phones = providers.map((p) => p.phone).filter((v): v is string => v != null && v.length > 0)

  // Nudge history — one batched query, in-memory pivot. Templates this module owns.
  const nudgeTemplateNames = [
    'provider_kyc_nudge',
    'provider_profile_photo_nudge',
    'provider_evidence_nudge',
    'provider_high_risk_cert_nudge',
    'provider_quality_multi_nudge',
  ]
  const nudgeEvents = phones.length
    ? await db.messageEvent.findMany({
        where: {
          to: { in: phones },
          templateName: { in: nudgeTemplateNames },
        },
        select: { to: true, templateName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : []

  // Index nudges by recipient phone for O(1) lookup.
  const nudgesByPhone = new Map<string, typeof nudgeEvents>()
  for (const event of nudgeEvents) {
    const list = nudgesByPhone.get(event.to)
    if (list) list.push(event)
    else nudgesByPhone.set(event.to, [event])
  }

  const rows: ProviderQualityRow[] = providers.map((p) => {
    const certifications: ProviderQualityInput['certifications'] = [
      ...p.technicianCertifications.map((c) => ({
        code: c.certificationCode,
        status: c.status,
        evidenceUrl: c.evidenceUrl,
        verifiedAt: c.verifiedAt,
      })),
      ...p.adminCertifications.map((c) => ({
        code: c.name,
        status: c.verifiedAt ? 'VERIFIED' : undefined,
        evidenceUrl: c.documentUrl,
        verifiedAt: c.verifiedAt,
      })),
    ]

    const snapshot = computeProviderQuality({
      id: p.id,
      name: p.name,
      firstName: p.name?.split(' ')[0] ?? null,
      phone: p.phone,
      active: p.active,
      skills: p.skills,
      avatarUrl: p.avatarUrl,
      portfolioUrls: p.portfolioUrls,
      kycStatus: p.kycStatus,
      certifications,
    })

    const nudges = (p.phone ? nudgesByPhone.get(p.phone) : null) ?? []
    const lastNudge = nudges[0] ?? null

    return {
      provider: {
        id: p.id,
        name: p.name,
        phone: p.phone,
        skills: p.skills,
        active: p.active,
        createdAt: p.createdAt,
      },
      snapshot,
      lastNudgeAt: lastNudge?.createdAt ?? null,
      lastNudgeTemplate: lastNudge?.templateName ?? null,
      nudgeCount: nudges.length,
    }
  })

  // Apply the in-memory filter — narrow on the computed snapshot, not raw fields,
  // so the UI's filters match exactly what the snapshot says.
  const filtered = rows.filter((row) => matchesFilter(row, filter))

  // Honour limit/offset after filtering so the admin table paging is accurate.
  if (filter.offset || filter.limit) {
    const start = filter.offset ?? 0
    const end = filter.limit ? start + filter.limit : undefined
    return filtered.slice(start, end)
  }
  return filtered
}

function matchesFilter(row: ProviderQualityRow, filter: QualityFilter): boolean {
  const { snapshot } = row
  if (filter.missingKyc && snapshot.dimensions.kyc === 'PRESENT') return false
  if (filter.missingProfilePhoto && snapshot.dimensions.profile_photo === 'PRESENT') return false
  if (filter.missingPortfolioEvidence && snapshot.dimensions.portfolio_evidence === 'PRESENT') return false
  if (filter.missingHighRiskCert) {
    if (!snapshot.hasHighRiskSkill) return false
    const certState = snapshot.dimensions.high_risk_cert
    if (certState === 'PRESENT' || certState === 'NOT_APPLICABLE') return false
  }
  if (filter.hasHighRiskSkill && !snapshot.hasHighRiskSkill) return false
  if (filter.notQualityReady && snapshot.isQualityReady) return false
  if (filter.kycStartedIncomplete) {
    if (snapshot.dimensions.kyc !== 'IN_PROGRESS' && snapshot.dimensions.kyc !== 'NEEDS_REVIEW') return false
  }
  if (filter.kycFailedOrExpired && snapshot.dimensions.kyc !== 'FAILED') return false
  return true
}

/** Single-pass aggregate of every snapshot in the system — for the report header. */
export async function getQualityCounts(): Promise<ProviderQualityCounts> {
  const rows = await loadProviderQualityRows()
  const activeFlags = Object.fromEntries(rows.map((r) => [r.provider.id, r.provider.active]))
  return aggregateQualityCounts(
    rows.map((r) => r.snapshot),
    activeFlags,
  )
}

/** Helper used by the script + report — returns the count breakdown only. */
export type { ProviderQualityCounts, QualityDimension }
