// ─── Feature flag tests ───────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isEnabled, isEnabledSync, invalidateFlagCache } from '@/lib/flags'

// Mock the DB — flags.ts imports db directly
vi.mock('@/lib/db', () => ({
  db: {
    featureFlag: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

import { db } from '@/lib/db'
const mockFindMany = db.featureFlag.findMany as ReturnType<typeof vi.fn>

const ENV_KEY = 'FEATURE_FLAGS'

describe('isEnabled — default behaviour', () => {
  beforeEach(() => {
    invalidateFlagCache()
    vi.clearAllMocks()
    delete process.env[ENV_KEY]
  })

  it('returns false by default when no DB row and no env var', async () => {
    mockFindMany.mockResolvedValue([])
    expect(await isEnabled('ops.v2.closeOut')).toBe(false)
  })

  it('returns true when DB row has enabled=true', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'ops.v2.closeOut', enabled: true, enabledForUsers: [] },
    ])
    expect(await isEnabled('ops.v2.closeOut')).toBe(true)
  })

  it('returns false when DB row has enabled=false and no user match', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'ops.v2.closeOut', enabled: false, enabledForUsers: [] },
    ])
    expect(await isEnabled('ops.v2.closeOut')).toBe(false)
  })
})

describe('isEnabled — per-user enabledForUsers', () => {
  beforeEach(() => {
    invalidateFlagCache()
    vi.clearAllMocks()
    delete process.env[ENV_KEY]
  })

  it('returns true for a user in enabledForUsers even when enabled=false', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'ops.v2.closeOut', enabled: false, enabledForUsers: ['user_abc', 'user_def'] },
    ])
    expect(await isEnabled('ops.v2.closeOut', { userId: 'user_abc' })).toBe(true)
  })

  it('returns false for a user NOT in enabledForUsers', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'ops.v2.closeOut', enabled: false, enabledForUsers: ['user_abc'] },
    ])
    expect(await isEnabled('ops.v2.closeOut', { userId: 'user_xyz' })).toBe(false)
  })

  it('enabled=true overrides and returns true for any user', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'ops.v2.closeOut', enabled: true, enabledForUsers: [] },
    ])
    expect(await isEnabled('ops.v2.closeOut', { userId: 'user_random' })).toBe(true)
  })
})

describe('isEnabled — env var override', () => {
  beforeEach(() => {
    invalidateFlagCache()
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('returns true when FEATURE_FLAGS env var enables the key', async () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true })
    mockFindMany.mockResolvedValue([]) // no DB row
    expect(await isEnabled('ops.v2.closeOut')).toBe(true)
  })

  it('env var false keeps default false when no DB row', async () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': false })
    mockFindMany.mockResolvedValue([])
    expect(await isEnabled('ops.v2.closeOut')).toBe(false)
  })

  it('DB row takes precedence over env var', async () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': false })
    mockFindMany.mockResolvedValue([
      { key: 'ops.v2.closeOut', enabled: true, enabledForUsers: [] },
    ])
    expect(await isEnabled('ops.v2.closeOut')).toBe(true)
  })
})

describe('isEnabledSync', () => {
  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('returns false when no env var set', () => {
    expect(isEnabledSync('ops.v2.closeOut')).toBe(false)
  })

  it('returns true when env var enables key', () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true })
    expect(isEnabledSync('ops.v2.closeOut')).toBe(true)
  })

  it('returns false for unknown keys', () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true })
    expect(isEnabledSync('ops.v2.unknown')).toBe(false)
  })
})
