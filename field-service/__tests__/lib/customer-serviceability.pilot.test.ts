import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled, mockGetElectricalReadiness } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockGetElectricalReadiness: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/launch/electrical-readiness', () => ({
  getElectricalReadiness: mockGetElectricalReadiness,
}))

import { checkPilotGate } from '@/lib/customer-serviceability'

describe('checkPilotGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when master flag is OFF', () => {
    it('always returns ok=true (legacy behaviour preserved)', async () => {
      mockIsEnabled.mockResolvedValue(false)

      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__sandton__sandhurst',
        rawCategory: 'electrical',
      })

      expect(result).toEqual({ ok: true })
      expect(mockGetElectricalReadiness).not.toHaveBeenCalled()
    })
  })

  describe('when master flag is ON', () => {
    beforeEach(() => {
      // Default: master ON, electrical_gate OFF
      mockIsEnabled.mockImplementation(async (key: string) => {
        if (key === 'launch.west_rand_pilot.enabled') return true
        if (key === 'launch.west_rand_pilot.electrical_gate') return false
        return false
      })
    })

    it('accepts a pilot suburb + pilot category', async () => {
      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
        rawCategory: 'plumbing',
      })
      expect(result).toEqual({ ok: true })
    })

    it('rejects a non-pilot suburb', async () => {
      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__sandton__sandhurst',
        rawCategory: 'plumbing',
      })
      expect(result).toEqual({ ok: false, code: 'pilot.suburb_not_supported' })
    })

    it('rejects null/empty suburb slug', async () => {
      const result = await checkPilotGate({ suburbSlug: null, rawCategory: 'plumbing' })
      expect(result).toEqual({ ok: false, code: 'pilot.suburb_not_supported' })
    })

    it('rejects a non-pilot category (electrical) at a pilot suburb', async () => {
      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
        rawCategory: 'electrical',
      })
      expect(result).toEqual({ ok: false, code: 'pilot.category_not_supported' })
    })

    it('canonicalizes label variants before allowlist check', async () => {
      // "Plumbing" → "plumbing" via canonicalizeServiceCategoryValue
      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
        rawCategory: 'Plumbing',
      })
      expect(result).toEqual({ ok: true })
    })

    it('rejects null/empty category', async () => {
      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
        rawCategory: null,
      })
      expect(result).toEqual({ ok: false, code: 'pilot.category_not_supported' })
    })
  })

  describe('electrical gate (electrical_gate flag ON)', () => {
    beforeEach(() => {
      mockIsEnabled.mockImplementation(async (key: string) => {
        if (key === 'launch.west_rand_pilot.enabled') return true
        if (key === 'launch.west_rand_pilot.electrical_gate') return true
        return false
      })
    })

    it('still rejects electrical because it is not in allowedCategorySlugs (dead path in v1)', async () => {
      mockGetElectricalReadiness.mockResolvedValue({
        ready: true,
        approvedCount: 5,
        threshold: 3,
        shortfall: 0,
      })

      const result = await checkPilotGate({
        suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
        rawCategory: 'electrical',
      })

      // Allowlist gate runs before readiness gate, so the result is still
      // category_not_supported, not electrical_disabled.
      expect(result).toEqual({ ok: false, code: 'pilot.category_not_supported' })
      expect(mockGetElectricalReadiness).not.toHaveBeenCalled()
    })
  })
})
