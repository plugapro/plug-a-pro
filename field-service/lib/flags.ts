import { db } from './db'

/**
 * Check if a feature flag is enabled for a given user.
 *
 * Resolution order (first match wins):
 * 1. DB row in feature_flags — per-user override via enabledForUsers[], then global enabled
 * 2. FEATURE_FLAGS JSON env var — e.g. {"admin.crud.locations": true}
 * 3. Default: false
 */
export async function isEnabled(key: string, userId?: string): Promise<boolean> {
  try {
    const flag = await db.featureFlag.findUnique({
      where: { key },
      select: { enabled: true, enabledForUsers: true },
    })

    if (flag) {
      if (userId && flag.enabledForUsers.includes(userId)) return true
      return flag.enabled
    }
  } catch {
    // DB unavailable or table not yet migrated — fall through to env
  }

  const envFlags = process.env.FEATURE_FLAGS
  if (envFlags) {
    try {
      const parsed = JSON.parse(envFlags) as Record<string, boolean>
      if (typeof parsed[key] === 'boolean') return parsed[key]
    } catch {
      // malformed JSON — ignore
    }
  }

  return false
}

/** Upsert a feature flag row (used by seed-flags scripts). */
export async function setFlag(
  key: string,
  opts: { enabled: boolean; description?: string; enabledForUsers?: string[] }
): Promise<void> {
  await db.featureFlag.upsert({
    where: { key },
    create: {
      key,
      enabled: opts.enabled,
      description: opts.description ?? null,
      enabledForUsers: opts.enabledForUsers ?? [],
    },
    update: {
      enabled: opts.enabled,
      ...(opts.description !== undefined && { description: opts.description }),
      ...(opts.enabledForUsers !== undefined && { enabledForUsers: opts.enabledForUsers }),
    },
  })
}
