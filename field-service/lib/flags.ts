// ─── Feature flag primitive ───────────────────────────────────────────────────
// isEnabled(key, ctx?) → boolean
//
// Evaluation order (first match wins):
//   1. DB: FeatureFlag row where key matches
//      - If enabled=true → true for everyone
//      - If enabled=false but ctx.userId in enabledForUsers → true for that user
//      - If enabled=false and no user match → false
//   2. Env: FEATURE_FLAGS JSON object, e.g. '{"ops.v2.closeOut": true}'
//   3. Default: false
//
// DB lookups are cached per process for 60 s to avoid per-request Prisma calls.

import { db } from './db'

// ─── Flag keys ────────────────────────────────────────────────────────────────

export const FLAG_KEYS = {
  OPS_CLOSE_OUT:       'ops.v2.closeOut',
  OPS_NOTES:           'ops.v2.notes',
  OPS_AUDIT:           'ops.v2.audit',
  OPS_BREACH_BANNER:   'ops.v2.breachBanner',
  OPS_DISPATCH_OVRD:   'ops.v2.dispatchOverride',
  OPS_PROFILE_V2:      'ops.v2.profileV2',
  OPS_BULK_ACTIONS:    'ops.v2.bulkActions',
  OPS_DUPLICATES:      'ops.v2.duplicates',
  // Qualified Shortlist Model — when enabled, dispatchMatchLead sends
  // free "I'm interested" / "Not interested" buttons instead of the legacy
  // paid "Accept Lead" buttons. Selected-provider acceptance still occurs via
  // the confirm_accept:<leadId> button surfaced after customer selection.
  SHORTLIST_DISPATCH_V2: 'qualified_shortlist.dispatch_v2',
  // When enabled, respondToProviderOpportunity automatically triggers
  // generateCustomerShortlistForRequest after the Nth interested response
  // (default N=2; configurable via SHORTLIST_AUTO_TRIGGER_THRESHOLD).
  SHORTLIST_AUTO_TRIGGER: 'qualified_shortlist.auto_trigger',
  // M1-T8: CustomerMember operator delegation.
  // When enabled, resolveCustomerForSession checks CustomerMember by phone/userId.
  // If an active membership is found the session resolves to the principal customer
  // account, allowing business team members to book under the company account.
  CUSTOMER_OPERATOR_MEMBER: 'feature.customer.operator_member',
  // Code-level safety gate for routing Supabase Auth OTPs through WhatsApp.
  // The real kill switch is the Send SMS Hook URL in the Supabase dashboard —
  // removing it reverts delivery to Supabase's built-in SMS. This flag exists
  // so the hook endpoint can refuse to deliver if the rollout needs an
  // immediate pause without a dashboard round-trip.
  AUTH_OTP_WHATSAPP: 'auth.otp.whatsapp',
} as const

export type FlagKey = typeof FLAG_KEYS[keyof typeof FLAG_KEYS]

// ─── DB cache ─────────────────────────────────────────────────────────────────

type CachedFlag = { enabled: boolean; enabledForUsers: string[] }
type FlagCache  = { flags: Map<string, CachedFlag>; expiresAt: number }

let _cache: FlagCache | null = null
const CACHE_TTL_MS = 60_000

async function loadFlagsFromDb(): Promise<Map<string, CachedFlag>> {
  try {
    const rows = await db.featureFlag.findMany()
    const map = new Map<string, CachedFlag>()
    for (const row of rows) {
      map.set(row.key, { enabled: row.enabled, enabledForUsers: row.enabledForUsers })
    }
    return map
  } catch {
    // DB unavailable — fall through to env/default
    return new Map()
  }
}

async function getFlags(): Promise<Map<string, CachedFlag>> {
  const now = Date.now()
  if (_cache && _cache.expiresAt > now) return _cache.flags

  const flags = await loadFlagsFromDb()
  _cache = { flags, expiresAt: now + CACHE_TTL_MS }
  return flags
}

// ─── Env override ─────────────────────────────────────────────────────────────

function getEnvFlags(): Record<string, boolean> {
  const raw = process.env.FEATURE_FLAGS
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isEnabled(
  key: string,
  ctx?: { userId?: string }
): Promise<boolean> {
  // 1 — DB
  const flags = await getFlags()
  const row = flags.get(key)
  if (row !== undefined) {
    if (row.enabled) return true
    if (ctx?.userId && row.enabledForUsers.includes(ctx.userId)) return true
    return false
  }

  // 2 — env
  const envFlags = getEnvFlags()
  if (key in envFlags) return Boolean(envFlags[key])

  // 3 — default
  return false
}

/** Synchronous check — only reads env (no DB). Use in non-async contexts. */
export function isEnabledSync(key: string): boolean {
  const envFlags = getEnvFlags()
  return key in envFlags ? Boolean(envFlags[key]) : false
}

/** Invalidate the in-process cache. Useful in tests. */
export function invalidateFlagCache(): void {
  _cache = null
}

/** Upsert a feature flag row. Used by seed-flags script. */
export async function setFlag(
  key: string,
  opts: { enabled: boolean; description?: string }
): Promise<void> {
  await db.featureFlag.upsert({
    where: { key },
    create: { key, enabled: opts.enabled, description: opts.description ?? '' },
    update: { enabled: opts.enabled, ...(opts.description ? { description: opts.description } : {}) },
  })
  invalidateFlagCache()
}
