import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db', () => ({
  db: {
    featureFlag: { findUnique: vi.fn() },
  },
}))

import { isEnabled } from '../../lib/flags'
import { db } from '../../lib/db'

const mockFindUnique = vi.mocked(db.featureFlag.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FEATURE_FLAGS
})

describe('isEnabled', () => {
  it('returns false by default when no DB row and no env var', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await isEnabled('admin.crud.locations')).toBe(false)
  })

  it('returns true when DB row has enabled=true', async () => {
    mockFindUnique.mockResolvedValue({ enabled: true, enabledForUsers: [] })
    expect(await isEnabled('admin.crud.locations')).toBe(true)
  })

  it('returns false when DB row has enabled=false', async () => {
    mockFindUnique.mockResolvedValue({ enabled: false, enabledForUsers: [] })
    expect(await isEnabled('admin.crud.locations')).toBe(false)
  })

  it('returns true for per-user DB override even when global is false', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: false,
      enabledForUsers: ['user-abc'],
    })
    expect(await isEnabled('admin.crud.locations', 'user-abc')).toBe(true)
  })

  it('returns false for a different user when enabledForUsers does not include them', async () => {
    mockFindUnique.mockResolvedValue({
      enabled: false,
      enabledForUsers: ['user-abc'],
    })
    expect(await isEnabled('admin.crud.locations', 'user-xyz')).toBe(false)
  })

  it('falls back to FEATURE_FLAGS env var when no DB row', async () => {
    mockFindUnique.mockResolvedValue(null)
    process.env.FEATURE_FLAGS = JSON.stringify({ 'admin.crud.locations': true })
    expect(await isEnabled('admin.crud.locations')).toBe(true)
  })

  it('env var returns false when flag is explicitly false', async () => {
    mockFindUnique.mockResolvedValue(null)
    process.env.FEATURE_FLAGS = JSON.stringify({ 'admin.crud.locations': false })
    expect(await isEnabled('admin.crud.locations')).toBe(false)
  })

  it('returns false when DB throws (graceful degradation)', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB unavailable'))
    expect(await isEnabled('admin.crud.locations')).toBe(false)
  })
})
