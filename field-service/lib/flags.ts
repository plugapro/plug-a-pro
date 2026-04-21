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
