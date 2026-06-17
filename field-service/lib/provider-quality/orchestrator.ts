// Provider Quality nudge orchestrator — preview + send, with dedup,
// feature-flag gating, and audit logging.
//
// CALLERS:
//   - app/(admin)/admin/quality/actions.ts (server actions)
//   - scripts/provider-quality-report.ts  (dry-run report)
//
// IMPORTANT: every actual outbound send goes through sendTemplate from
// lib/whatsapp.ts. This module never touches the WhatsApp API directly so the
// test suite can stub a single dependency.

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import {
  isRecentlyNudged,
  NUDGE_MAX_PER_DIMENSION,
  NUDGE_SPACING_DAYS,
  planNudgeForProvider,
  type ProviderNudgePlan,
} from './nudge'
import { loadProviderQualityRows, type QualityFilter } from './queries'

export const QUALITY_UPLIFT_FLAG = 'admin.quality.uplift'

const PROVIDER_DASHBOARD_PATH = '/provider/profile'
const KYC_RESUME_PATH = '/provider/verify'
const EVIDENCE_UPLOAD_PATH = '/provider/profile/evidence'

type ProviderQualityRow = Awaited<ReturnType<typeof loadProviderQualityRows>>[number]

export interface NudgePreviewItem {
  providerId: string
  providerName: string | null
  phone: string | null
  plan: ProviderNudgePlan
  /** True if the dedup window would currently block a real send. */
  blockedByRecentNudge: boolean
  /** True if the max per-dimension cap would currently block a real send. */
  blockedByCap: boolean
  /** Set when there is no phone number to message. */
  blockedReason: string | null
  /** Nudges of THIS dimension already sent to the provider, ever. */
  priorSends: number
  /** Most-recent send timestamp of THIS dimension's template. Null if never. */
  lastSentAt: Date | null
}

export interface NudgePreview {
  generatedAt: Date
  filter: QualityFilter
  flagEnabled: boolean
  totalProvidersConsidered: number
  totalSendable: number
  totalBlocked: number
  items: NudgePreviewItem[]
}

export interface NudgeSendResult {
  sentCount: number
  skippedCount: number
  failedCount: number
  failures: Array<{ providerId: string; reason: string }>
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://app.plugapro.co.za'
  )
}

function buildContextForRow(row: ProviderQualityRow): {
  firstName: string
  links: ProviderNudgePlan['missingItems'] extends never[] ? Record<never, string> : Record<string, string>
  profileLink: string
} {
  const base = appBaseUrl()
  const firstName = (row.provider.name ?? '').split(' ')[0] || 'there'
  return {
    firstName,
    links: {
      kyc: `${base}${KYC_RESUME_PATH}`,
      profile_photo: `${base}${PROVIDER_DASHBOARD_PATH}`,
      portfolio_evidence: `${base}${EVIDENCE_UPLOAD_PATH}`,
      high_risk_cert: `${base}${EVIDENCE_UPLOAD_PATH}`,
    },
    profileLink: `${base}${PROVIDER_DASHBOARD_PATH}`,
  }
}

/**
 * Compute the nudge plan for every provider in the filtered set.
 * No WhatsApp calls. Safe to call from a UI route.
 */
export async function previewNudges(filter: QualityFilter = {}): Promise<NudgePreview> {
  const flagEnabled = await isEnabled(QUALITY_UPLIFT_FLAG).catch(() => false)
  const rows = await loadProviderQualityRows(filter)
  const now = Date.now()
  const cutoff = new Date(now - NUDGE_SPACING_DAYS * 24 * 60 * 60 * 1000)

  // One batched MessageEvent query for dedup state. Filter narrowing is
  // already applied in `rows`, so we only query the phones we plan to message.
  const phones = rows.map((r) => r.provider.phone).filter((v): v is string => v != null && v.length > 0)
  const rawEvents = phones.length
    ? await db.messageEvent.findMany({
        where: {
          to: { in: phones },
          templateName: {
            in: [
              'provider_kyc_nudge',
              'provider_profile_photo_nudge',
              'provider_evidence_nudge',
              'provider_high_risk_cert_nudge',
              'provider_quality_multi_nudge',
            ],
          },
        },
        select: { to: true, templateName: true, createdAt: true },
      })
    : []
  // Narrow templateName to non-null so isRecentlyNudged's signature lines up.
  const events: Array<{ to: string; templateName: string; createdAt: Date }> = rawEvents
    .filter((e): e is typeof e & { templateName: string } => e.templateName != null)

  const byPhone = new Map<string, typeof events>()
  for (const e of events) {
    const list = byPhone.get(e.to)
    if (list) list.push(e)
    else byPhone.set(e.to, [e])
  }

  const items: NudgePreviewItem[] = []
  for (const row of rows) {
    if (!row.provider.active) continue
    const ctx = buildContextForRow(row)
    const plan = planNudgeForProvider(row.snapshot, ctx)
    if (!plan) continue
    const phone = row.provider.phone
    const blockedReason = phone == null || phone.length === 0 ? 'NO_PHONE' : null
    const history = phone ? byPhone.get(phone) ?? [] : []
    const dimensionEvents = history.filter((e) => e.templateName === plan.templateName)
    const blockedByRecentNudge = isRecentlyNudged(history, plan.templateName)
    const blockedByCap = dimensionEvents.length >= NUDGE_MAX_PER_DIMENSION
    const lastSentAt = dimensionEvents.reduce<Date | null>((latest, e) => {
      if (!latest || e.createdAt > latest) return e.createdAt
      return latest
    }, null)
    void cutoff // referenced for the consumer's awareness of the threshold
    items.push({
      providerId: row.provider.id,
      providerName: row.provider.name,
      phone,
      plan,
      blockedByRecentNudge,
      blockedByCap,
      blockedReason,
      priorSends: dimensionEvents.length,
      lastSentAt,
    })
  }

  const totalSendable = items.filter(
    (i) => !i.blockedByRecentNudge && !i.blockedByCap && !i.blockedReason,
  ).length

  return {
    generatedAt: new Date(),
    filter,
    flagEnabled,
    totalProvidersConsidered: rows.length,
    totalSendable,
    totalBlocked: items.length - totalSendable,
    items,
  }
}

/**
 * Send a batch of approved nudges. Always re-checks dedup (preview is a snapshot).
 * Behind QUALITY_UPLIFT_FLAG so this can ship dark and be flipped per env.
 */
export async function sendNudges(args: {
  providerIds: string[]
  /** When true, ignore the per-dimension recent-send cap. Use for ops-led overrides. */
  forceOverrideRecency?: boolean
  /** Actor for audit trail. */
  actorId: string
  actorRole: 'OPS' | 'ADMIN' | 'OWNER' | 'TRUST' | 'FINANCE'
}): Promise<NudgeSendResult> {
  const flagEnabled = await isEnabled(QUALITY_UPLIFT_FLAG).catch(() => false)
  if (!flagEnabled) {
    return {
      sentCount: 0,
      skippedCount: 0,
      failedCount: args.providerIds.length,
      failures: args.providerIds.map((id) => ({ providerId: id, reason: 'FEATURE_DISABLED' })),
    }
  }

  // Re-derive the preview so we always send the up-to-date plan. Filter by ids.
  const preview = await previewNudges({})
  const wanted = new Set(args.providerIds)
  const candidates = preview.items.filter((i) => wanted.has(i.providerId))

  let sentCount = 0
  let skippedCount = 0
  let failedCount = 0
  const failures: NudgeSendResult['failures'] = []

  // Import the real send adapter lazily so tests can mock without touching
  // the module graph that this orchestrator imports.
  const { sendTemplate } = await import('@/lib/whatsapp')

  for (const item of candidates) {
    if (item.blockedReason) {
      skippedCount++
      failures.push({ providerId: item.providerId, reason: item.blockedReason })
      continue
    }
    if (item.blockedByCap) {
      skippedCount++
      failures.push({ providerId: item.providerId, reason: 'MAX_NUDGES_REACHED' })
      continue
    }
    if (item.blockedByRecentNudge && !args.forceOverrideRecency) {
      skippedCount++
      failures.push({ providerId: item.providerId, reason: 'RECENTLY_NUDGED' })
      continue
    }

    try {
      const firstName = (item.providerName ?? '').split(' ')[0] || 'there'
      const baseBody = {
        type: 'body' as const,
        parameters: [{ type: 'text' as const, text: firstName }],
      }
      // Multi-template carries the bullet list as {{2}}. Single-dimension
      // templates use {{1}}=firstName only; the CTA URL is a static button
      // (resolved at template-definition time in Meta Business Manager).
      const components =
        item.plan.dimension === 'multi'
          ? [
              {
                ...baseBody,
                parameters: [
                  ...baseBody.parameters,
                  {
                    type: 'text' as const,
                    text: item.plan.missingItems
                      .map((d) => `- ${d.replace(/_/g, ' ')}`)
                      .join('\n'),
                  },
                ],
              },
            ]
          : [baseBody]

      await sendTemplate({
        to: item.phone!,
        // The TemplateName union is auto-derived from messaging-templates.ts.
        // Every templateName used here was registered in that registry.
        template: item.plan.templateName as Parameters<typeof sendTemplate>[0]['template'],
        components,
        metadata: {
          providerId: item.providerId,
          ...item.plan.metadata,
          actorId: args.actorId,
          actorRole: args.actorRole,
        },
      })
      sentCount++
    } catch (error) {
      failedCount++
      failures.push({
        providerId: item.providerId,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { sentCount, skippedCount, failedCount, failures }
}
