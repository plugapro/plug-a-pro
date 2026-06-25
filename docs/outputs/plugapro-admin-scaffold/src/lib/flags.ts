// Feature flag primitive.
//
// Resolution order (first hit wins):
//   1. DB override per user   (FeatureFlag.enabledForUsers contains userId)
//   2. DB override global      (FeatureFlag.enabled === true)
//   3. Environment variable    (FEATURE_FLAGS='{"flag.key": true}')
//   4. Default false
//
// Adjust the first check if you have a different flag store already.

import { db } from './db';

export type FlagKey =
  | 'admin.crud.locations'
  | 'admin.crud.customers'
  | 'admin.crud.providers'
  | 'admin.crud.requests'
  | 'admin.crud.bookings'
  | 'admin.crud.payments'
  | 'admin.crud.disputes'
  | 'admin.crud.categories'
  | 'admin.users.v2'
  | 'admin.search.global'
  | 'admin.bulk.v1'
  | 'admin.export.csv'
  // Keep extending as the app grows.
  ;

interface FlagContext {
  userId?: string;
}

let envCache: Record<string, boolean> | null = null;

function readEnv(): Record<string, boolean> {
  if (envCache) return envCache;
  try {
    envCache = JSON.parse(process.env.FEATURE_FLAGS || '{}');
  } catch {
    envCache = {};
  }
  return envCache!;
}

// In-memory short TTL cache so we don't hammer the DB.
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { value: { enabled: boolean; enabledForUsers: string[] }; ts: number }>();

async function readDb(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const row = await db.featureFlag.findUnique({ where: { key } });
  const value = row
    ? { enabled: row.enabled, enabledForUsers: row.enabledForUsers }
    : { enabled: false, enabledForUsers: [] as string[] };
  cache.set(key, { value, ts: Date.now() });
  return value;
}

/**
 * Returns true if the feature is enabled for the caller.
 * Call this in server components, server actions, and API routes.
 */
export async function isEnabled(key: FlagKey, ctx: FlagContext = {}): Promise<boolean> {
  const dbVal = await readDb(key);
  if (ctx.userId && dbVal.enabledForUsers.includes(ctx.userId)) return true;
  if (dbVal.enabled) return true;
  const envVal = readEnv();
  return envVal[key] === true;
}

/**
 * Throws if the flag is off. Use at the top of guarded server actions.
 */
export async function requireFlag(key: FlagKey, ctx: FlagContext = {}): Promise<void> {
  if (!(await isEnabled(key, ctx))) {
    throw new FlagDisabledError(key);
  }
}

export class FlagDisabledError extends Error {
  constructor(public readonly flag: string) {
    super(`Feature flag not enabled: ${flag}`);
    this.name = 'FlagDisabledError';
  }
}

// For tests: clear the cache.
export function __resetFlagCache() {
  cache.clear();
  envCache = null;
}
