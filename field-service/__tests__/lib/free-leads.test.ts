import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))

vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))

import {
  FREE_LEAD_BREAKDOWN,
  FREE_LEADS_COPY_LINE,
  FREE_LEADS_FLAG,
  isFreeLeadUnlock,
  isFreeLeadsEnabled,
} from '../../lib/free-leads'
import { FEATURE_FLAGS_REGISTRY } from '../../lib/feature-flags-registry'

describe('free leads helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers provider.leads.free defaulting to OFF', () => {
    expect(FREE_LEADS_FLAG).toBe('provider.leads.free')
    expect(FEATURE_FLAGS_REGISTRY['provider.leads.free'].defaultValue).toBe(false)
  })

  it('reads the provider.leads.free flag', async () => {
    mockIsEnabled.mockResolvedValue(true)
    await expect(isFreeLeadsEnabled()).resolves.toBe(true)
    expect(mockIsEnabled).toHaveBeenCalledWith('provider.leads.free')

    mockIsEnabled.mockResolvedValue(false)
    await expect(isFreeLeadsEnabled()).resolves.toBe(false)
  })

  it('fails closed (paid leads) when the flag cannot be evaluated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockIsEnabled.mockRejectedValue(new Error('db down'))

    await expect(isFreeLeadsEnabled()).resolves.toBe(false)
    warn.mockRestore()
  })

  it('identifies free unlocks by a persisted creditsCharged of 0', () => {
    expect(isFreeLeadUnlock({ creditsCharged: 0 })).toBe(true)
    expect(isFreeLeadUnlock({ creditsCharged: 1 })).toBe(false)
  })

  it('exposes the free breakdown and copy line', () => {
    expect(FREE_LEAD_BREAKDOWN).toEqual({ free: true })
    expect(FREE_LEADS_COPY_LINE).toBe('Free during launch — no credits needed.')
  })
})
