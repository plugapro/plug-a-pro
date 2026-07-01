/**
 * Meta "Click to WhatsApp" (CTWA) referral handling.
 *
 * When a user opens a WhatsApp conversation from a Meta ad, the FIRST inbound
 * message carries a `referral` object identifying the ad (source_id), the
 * click id (ctwa_clid), and the creative copy (headline/body). We use it to:
 *   1. Route provider-recruitment ad traffic straight into registration,
 *      bypassing the generic welcome menu (flag: whatsapp.registration.ctwa_referral_route).
 *   2. Persist attribution on the conversation so the eventual
 *      ProviderApplication can be tied back to the ad that paid for it.
 *
 * Unlike lib/whatsapp-deeplinks.ts (which matches the *prefilled message text*
 * and silently breaks when Meta auto-generates openers like "Hello! Can I get
 * more info on this?"), the referral payload is present regardless of what the
 * opener says — it is the robust routing signal for ad traffic.
 *
 * To ship a new provider-recruitment ad without relying on the copy heuristic,
 * add its ad ID to the CTWA_PROVIDER_AD_IDS env var (comma-separated).
 */

/** Shape of `messages[].referral` on the WhatsApp Cloud API webhook. */
export interface CtwaReferral {
  source_url?: string
  source_id?: string
  source_type?: string // 'ad' | 'post'
  headline?: string
  body?: string
  media_type?: string
  ctwa_clid?: string
}

/** Attribution snapshot persisted into Conversation.data / ProviderApplication. */
export interface CtwaReferralAttribution {
  sourceType: string
  sourceId: string | null
  ctwaClid: string | null
  headline: string | null
  capturedAt: string
}

export type ReferralAudience = 'provider_recruitment' | 'unknown'

// Copy fragments that identify provider-recruitment creative. Kept lowercase;
// matched against headline + body. Deliberately conservative — a miss only
// means the user sees the normal welcome menu, exactly today's behaviour.
const PROVIDER_CREATIVE_MARKERS = [
  'service provider',
  'provider profile',
  'find work',
  'register your profile',
  'job requests',
  'skilled with your hands',
]

function providerAdIdsFromEnv(): Set<string> {
  return new Set(
    (process.env.CTWA_PROVIDER_AD_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

/**
 * Classify which funnel a CTWA referral belongs to.
 * Priority: explicit ad-id allowlist (env) → creative-copy heuristic → unknown.
 */
export function classifyReferralAudience(referral: CtwaReferral | null | undefined): ReferralAudience {
  if (!referral) return 'unknown'

  if (referral.source_id && providerAdIdsFromEnv().has(referral.source_id)) {
    return 'provider_recruitment'
  }

  const creative = `${referral.headline ?? ''} ${referral.body ?? ''}`.toLowerCase()
  if (creative.trim() && PROVIDER_CREATIVE_MARKERS.some((marker) => creative.includes(marker))) {
    return 'provider_recruitment'
  }

  return 'unknown'
}

/**
 * Reduce the raw webhook referral to the fields worth persisting.
 * Returns null when there is nothing identifying to store.
 */
export function toReferralAttribution(referral: CtwaReferral | null | undefined): CtwaReferralAttribution | null {
  if (!referral) return null
  if (!referral.source_id && !referral.ctwa_clid) return null
  return {
    sourceType: referral.source_type ?? 'unknown',
    sourceId: referral.source_id ?? null,
    ctwaClid: referral.ctwa_clid ?? null,
    headline: referral.headline?.slice(0, 200) ?? null,
    capturedAt: new Date().toISOString(),
  }
}
