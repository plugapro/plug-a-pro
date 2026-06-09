import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProviderCount } = vi.hoisted(() => ({
  mockProviderCount: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      count: mockProviderCount,
    },
  },
}))

import { getElectricalReadiness } from '@/lib/launch/electrical-readiness'
import { WEST_RAND_PILOT } from '@/lib/launch/west-rand-pilot'

describe('getElectricalReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries for ACTIVE + verified + kyc-verified providers with electrical skill', async () => {
    mockProviderCount.mockResolvedValue(0)

    await getElectricalReadiness()

    expect(mockProviderCount).toHaveBeenCalledTimes(1)
    expect(mockProviderCount).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        verified: true,
        kycStatus: 'VERIFIED',
        skills: { has: 'electrical' },
      },
    })
  })

  it('returns ready=false with shortfall when below threshold', async () => {
    mockProviderCount.mockResolvedValue(1)

    const result = await getElectricalReadiness()

    expect(result).toEqual({
      ready: false,
      approvedCount: 1,
      threshold: WEST_RAND_PILOT.electricalThreshold,
      shortfall: WEST_RAND_PILOT.electricalThreshold - 1,
    })
  })

  it('returns ready=true with shortfall=0 at threshold', async () => {
    mockProviderCount.mockResolvedValue(WEST_RAND_PILOT.electricalThreshold)

    const result = await getElectricalReadiness()

    expect(result).toEqual({
      ready: true,
      approvedCount: WEST_RAND_PILOT.electricalThreshold,
      threshold: WEST_RAND_PILOT.electricalThreshold,
      shortfall: 0,
    })
  })

  it('returns ready=true with shortfall=0 above threshold', async () => {
    mockProviderCount.mockResolvedValue(10)

    const result = await getElectricalReadiness()

    expect(result).toEqual({
      ready: true,
      approvedCount: 10,
      threshold: WEST_RAND_PILOT.electricalThreshold,
      shortfall: 0,
    })
  })
})
