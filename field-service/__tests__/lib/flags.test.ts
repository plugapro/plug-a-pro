// ─── Feature flag tests ───────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isEnabled,
  isEnabledSync,
  invalidateFlagCache,
  validateFeatureFlagsEnv,
  _resetEnvFlagsWarnedForTests,
} from '@/lib/flags'
import { FEATURE_FLAGS_REGISTRY } from '@/lib/feature-flags-registry'

// Mock the DB - flags.ts imports db directly
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

describe('feature flag registry', () => {
  it('registers OTP security flags disabled by default', () => {
    expect(FEATURE_FLAGS_REGISTRY['security.otp.report']).toMatchObject({
      owner: 'eng',
      defaultValue: false,
    })
    expect(FEATURE_FLAGS_REGISTRY['admin.security.otp']).toMatchObject({
      owner: 'ops',
      defaultValue: false,
    })
  })

  it('registers the provider identity verification fail-safe disabled by default', () => {
    expect(FEATURE_FLAGS_REGISTRY['provider.identity.verification.fail_safe']).toMatchObject({
      owner: 'eng',
      defaultValue: false,
    })
  })

  it('registers Didit document persistence disabled by default', () => {
    expect(FEATURE_FLAGS_REGISTRY['provider.identity.vendor.didit.persist_documents']).toMatchObject({
      owner: 'eng',
      defaultValue: false,
    })
  })

  it('registers provider PWA registration disabled by default', () => {
    expect(FEATURE_FLAGS_REGISTRY['provider.pwa.registration']).toMatchObject({
      owner: 'prod',
      defaultValue: false,
    })
  })
})

describe('isEnabled - default behaviour', () => {
  beforeEach(() => {
    invalidateFlagCache()
    vi.clearAllMocks()
    delete process.env[ENV_KEY]
  })

  it('returns false by default when no DB row and no env var', async () => {
    mockFindMany.mockResolvedValue([])
    expect(await isEnabled('ops.v2.closeOut')).toBe(false)
  })

  it('uses the registry default when no DB row and no env var are present', async () => {
    mockFindMany.mockResolvedValue([])
    expect(await isEnabled('provider.identity.verification.pilot_allowlist_required')).toBe(true)
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

  it('returns false when DB throws (graceful degradation)', async () => {
    mockFindMany.mockRejectedValue(new Error('DB unavailable'))
    expect(await isEnabled('ops.v2.closeOut')).toBe(false)
  })
})

describe('isEnabled - per-user enabledForUsers', () => {
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

describe('isEnabled - env var override', () => {
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

  it('uses registry defaults when no env var is set', () => {
    expect(isEnabledSync('provider.identity.verification.pilot_allowlist_required')).toBe(true)
  })

  it('returns true when env var enables key', () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true })
    expect(isEnabledSync('ops.v2.closeOut')).toBe(true)
  })

  it('returns false for unknown keys', () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true })
    const unknownKey = 'ops.v2.unknown' as Parameters<typeof isEnabledSync>[0]
    expect(isEnabledSync(unknownKey)).toBe(false)
  })
})

describe('validateFeatureFlagsEnv', () => {
  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('returns unset when env var is not set', () => {
    delete process.env[ENV_KEY]
    expect(validateFeatureFlagsEnv()).toEqual({ status: 'unset' })
  })

  it('returns valid with parsed keys when JSON object', () => {
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true, 'ops.v2.notes': false })
    const result = validateFeatureFlagsEnv()
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.keys.sort()).toEqual(['ops.v2.closeOut', 'ops.v2.notes'])
    }
  })

  it('returns malformed with reason when JSON.parse throws', () => {
    process.env[ENV_KEY] = '{not valid json'
    const result = validateFeatureFlagsEnv()
    expect(result.status).toBe('malformed')
    if (result.status === 'malformed') {
      expect(typeof result.reason).toBe('string')
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  it('returns wrong-shape when value is a JSON array', () => {
    process.env[ENV_KEY] = JSON.stringify(['ops.v2.closeOut'])
    const result = validateFeatureFlagsEnv()
    expect(result.status).toBe('wrong-shape')
    if (result.status === 'wrong-shape') {
      expect(result.reason).toContain('array')
    }
  })

  it('returns wrong-shape when value is a JSON number', () => {
    process.env[ENV_KEY] = '42'
    const result = validateFeatureFlagsEnv()
    expect(result.status).toBe('wrong-shape')
    if (result.status === 'wrong-shape') {
      expect(result.reason).toContain('number')
    }
  })

  it('returns wrong-shape when value is JSON null', () => {
    process.env[ENV_KEY] = 'null'
    const result = validateFeatureFlagsEnv()
    expect(result.status).toBe('wrong-shape')
  })

  it('does not log (pure)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[ENV_KEY] = '{bad json'
    validateFeatureFlagsEnv()
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('getEnvFlags one-shot warning (via isEnabledSync)', () => {
  beforeEach(() => {
    invalidateFlagCache()
    _resetEnvFlagsWarnedForTests()
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    _resetEnvFlagsWarnedForTests()
  })

  it('logs console.error exactly once across multiple calls when env var is malformed JSON', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[ENV_KEY] = '{not valid json'

    // Each call goes through getEnvFlags() internally.
    isEnabledSync('ops.v2.closeOut')
    isEnabledSync('ops.v2.closeOut')
    isEnabledSync('ops.v2.notes')

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0][0]).toContain('FEATURE_FLAGS env var is set but not valid JSON')
    // Make sure we never log the raw value, only length metadata.
    const metadata = errSpy.mock.calls[0][1] as { length: number }
    expect(metadata).toEqual({ length: process.env[ENV_KEY]!.length })

    errSpy.mockRestore()
  })

  it('still returns false (env overrides ignored) when env var is malformed', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[ENV_KEY] = '{not valid json'
    expect(isEnabledSync('ops.v2.closeOut')).toBe(false)
    errSpy.mockRestore()
  })

  it('logs once when env var parses but is not a plain object (array)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[ENV_KEY] = JSON.stringify(['ops.v2.closeOut'])

    isEnabledSync('ops.v2.closeOut')
    isEnabledSync('ops.v2.closeOut')

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0][0]).toContain('not a plain object')
    expect(errSpy.mock.calls[0][1]).toEqual({ shape: 'array' })

    errSpy.mockRestore()
  })

  it('does not log when env var is a valid object', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[ENV_KEY] = JSON.stringify({ 'ops.v2.closeOut': true })
    isEnabledSync('ops.v2.closeOut')
    isEnabledSync('ops.v2.closeOut')
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
