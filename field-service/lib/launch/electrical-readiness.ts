import { db } from '@/lib/db'

import { WEST_RAND_PILOT } from './west-rand-pilot'

export type ElectricalReadiness = {
  ready: boolean
  approvedCount: number
  threshold: number
  shortfall: number
}

export async function getElectricalReadiness(): Promise<ElectricalReadiness> {
  const threshold = WEST_RAND_PILOT.electricalThreshold
  const approvedCount = await db.provider.count({
    where: {
      status: 'ACTIVE',
      verified: true,
      kycStatus: 'VERIFIED',
      skills: { has: 'electrical' },
    },
  })
  const shortfall = Math.max(0, threshold - approvedCount)
  return {
    ready: approvedCount >= threshold,
    approvedCount,
    threshold,
    shortfall,
  }
}
