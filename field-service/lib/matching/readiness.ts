// ─── Provider matchability readiness ──────────────────────────────────────────
// PJ-01b (platform audit 2026-07-06): "approved" and "matchable" silently
// diverged — approval could complete while the provider still failed one or
// more hard matching gates (no active TechnicianServiceArea rows, KYC not
// verified, category rejected, …) and nobody could see why.
//
// getProviderMatchabilityReadiness() reproduces, for ONE provider, the
// provider-level hard gates applied by the matching pipeline:
//   - candidate pool prefilter (lib/matching/candidate-pool.ts):
//       active, verified, status=ACTIVE
//   - filter metrics query (lib/matching/filter.ts):
//       KYC boundary via buildProviderKycVisibilityWhere / kyc-grace
//   - filter hard checks (lib/matching/filter.ts):
//       ≥1 active service area, skills present, category approval
//
// Job-specific gates (schedule fit, availability pause, cooldowns, distance)
// are intentionally NOT reproduced: they depend on a concrete job request and
// do not make a provider structurally unmatchable.
//
// The KYC predicate is NOT forked — it reuses isKycGrandfathered from
// lib/matching/kyc-grace.ts (single source shared with the filter query).

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { KYC_GRACE_FLAG, isKycGrandfathered } from './kyc-grace'

export type MatchabilityCheckCode =
  | 'PROVIDER_ACTIVE'
  | 'PROVIDER_VERIFIED'
  | 'PROVIDER_STATUS_ACTIVE'
  | 'KYC_VERIFIED_OR_GRACE'
  | 'ACTIVE_SERVICE_AREA'
  | 'SKILLS_PRESENT'
  | 'CATEGORY_APPROVAL'

export type MatchabilityCheck = {
  code: MatchabilityCheckCode
  ok: boolean
  /** Human-readable admin-facing explanation (esp. for failures). */
  detail: string
}

export type ProviderMatchabilityReadiness = {
  providerId: string
  /** false when the provider row does not exist at all. */
  providerFound: boolean
  matchable: boolean
  checks: MatchabilityCheck[]
  /** Codes of failed checks — [] when matchable. */
  failReasonCodes: MatchabilityCheckCode[]
}

type ReadinessClient = {
  provider: {
    findUnique: (args: any) => Promise<{
      id: string
      active: boolean
      verified: boolean
      status: string
      kycStatus: string | null
      createdAt: Date | null
      skills: string[]
      technicianSkills?: Array<{ skillTag: string }>
      technicianServiceAreas?: Array<{ active: boolean }>
      providerCategories?: Array<{ categorySlug: string; approvalStatus: string }>
    } | null>
  }
}

export async function getProviderMatchabilityReadiness(
  providerId: string,
  client: ReadinessClient = db as unknown as ReadinessClient,
): Promise<ProviderMatchabilityReadiness> {
  const provider = await client.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      active: true,
      verified: true,
      status: true,
      kycStatus: true,
      createdAt: true,
      skills: true,
      technicianSkills: { where: { active: true }, select: { skillTag: true } },
      technicianServiceAreas: { where: { active: true }, select: { active: true }, take: 1 },
      providerCategories: { select: { categorySlug: true, approvalStatus: true } },
    },
  })

  if (!provider) {
    return {
      providerId,
      providerFound: false,
      matchable: false,
      checks: [],
      failReasonCodes: [],
    }
  }

  const kycGraceEnabled = await isEnabled(KYC_GRACE_FLAG).catch(() => false)
  const kycOk =
    provider.kycStatus === 'VERIFIED' ||
    isKycGrandfathered(provider.createdAt, kycGraceEnabled, provider.kycStatus)

  const activeServiceAreaCount = provider.technicianServiceAreas?.length ?? 0
  const skillCount = (provider.skills?.length ?? 0) + (provider.technicianSkills?.length ?? 0)

  // Category approval mirrors the filter's permissive default: a skill with NO
  // providerCategory row is not blocked; only explicit non-APPROVED rows block
  // that category. The provider is structurally unmatchable only when EVERY
  // skill category is explicitly blocked.
  const blockedByCategory = new Map(
    (provider.providerCategories ?? [])
      .filter((row) => row.approvalStatus !== 'APPROVED')
      .map((row) => [row.categorySlug.trim().toLowerCase(), row.approvalStatus]),
  )
  const skillSlugs = (provider.skills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  const blockedSkills = skillSlugs.filter((slug) => blockedByCategory.has(slug))
  const categoryOk = skillSlugs.length === 0 || blockedSkills.length < skillSlugs.length

  const checks: MatchabilityCheck[] = [
    {
      code: 'PROVIDER_ACTIVE',
      ok: provider.active,
      detail: provider.active ? 'Provider is active' : 'Provider record is inactive — excluded from every candidate pool',
    },
    {
      code: 'PROVIDER_VERIFIED',
      ok: provider.verified,
      detail: provider.verified ? 'Provider is verified' : 'Provider is not verified — excluded from every candidate pool',
    },
    {
      code: 'PROVIDER_STATUS_ACTIVE',
      ok: provider.status === 'ACTIVE',
      detail:
        provider.status === 'ACTIVE'
          ? 'Provider status is ACTIVE'
          : `Provider status is ${provider.status} — matching requires ACTIVE`,
    },
    {
      code: 'KYC_VERIFIED_OR_GRACE',
      ok: kycOk,
      detail: kycOk
        ? provider.kycStatus === 'VERIFIED'
          ? 'KYC verified'
          : 'KYC not verified but admitted by the legacy grace window'
        : `KYC status is ${provider.kycStatus ?? 'NOT_STARTED'} — matching requires VERIFIED${kycGraceEnabled ? ' (legacy grace does not apply)' : ''}`,
    },
    {
      code: 'ACTIVE_SERVICE_AREA',
      ok: activeServiceAreaCount > 0,
      detail:
        activeServiceAreaCount > 0
          ? 'Has at least one active structured service area'
          : 'No active TechnicianServiceArea rows — provider is invisible to structured matching (OUTSIDE_SERVICE_AREA on every request)',
    },
    {
      code: 'SKILLS_PRESENT',
      ok: skillCount > 0,
      detail: skillCount > 0 ? 'Has at least one skill' : 'No skills recorded — cannot pass the required-skill filter for any category',
    },
    {
      code: 'CATEGORY_APPROVAL',
      ok: categoryOk,
      detail: categoryOk
        ? blockedSkills.length > 0
          ? `Some categories blocked (${blockedSkills.join(', ')}) but at least one remains matchable`
          : 'No category blocks'
        : `Every skill category is explicitly blocked (${blockedSkills
            .map((slug) => `${slug}: ${blockedByCategory.get(slug)}`)
            .join(', ')})`,
    },
  ]

  const failReasonCodes = checks.filter((c) => !c.ok).map((c) => c.code)

  return {
    providerId,
    providerFound: true,
    matchable: failReasonCodes.length === 0,
    checks,
    failReasonCodes,
  }
}

/** Compact "approved BUT not matchable: …" suffix for admin feedback surfaces. */
export function formatMatchabilityWarning(readiness: ProviderMatchabilityReadiness): string | null {
  if (!readiness.providerFound || readiness.matchable) return null
  return readiness.failReasonCodes.join(',')
}
