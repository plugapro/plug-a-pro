import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    providerApplication: { findMany: vi.fn(), groupBy: vi.fn() },
    provider: { findMany: vi.fn() },
  },
}))

import { db } from '@/lib/db'
import { loadApplicationCandidates } from '@/lib/ops-agents/agents/application-review/loader'

 
const dbAny = db as any

function app(id: string, providerId: string, phone: string) {
  return {
    id,
    providerId,
    name: `Provider ${id}`,
    phone,
    alternateMobileE164: null,
    skills: ['plumbing'],
    serviceAreas: [],
    experience: null,
    availability: null,
    evidenceNote: null,
    evidenceFileUrls: [],
    idNumber: null,
    callOutFee: null,
    hourlyRate: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadApplicationCandidates — duplicate signal', () => {
  it('does NOT flag an applicant whose only same-phone Provider is their own nascent record', async () => {
    dbAny.providerApplication.findMany.mockResolvedValue([app('a', 'provA', '+27100')])
    dbAny.provider.findMany.mockResolvedValue([
      // the applicant's OWN nascent provider — must not be treated as a duplicate
      { id: 'provA', phone: '+27100', verified: false, status: 'APPLICATION_PENDING' },
    ])
    dbAny.providerApplication.groupBy.mockResolvedValue([{ phone: '+27100', _count: { phone: 1 } }])

    const [candidate] = await loadApplicationCandidates({ nowIso: '2026-06-21T16:00:00.000Z' })
    expect(candidate.duplicateSignal).toBe(false)
  })

  it('flags an applicant whose phone matches a DIFFERENT, established Provider', async () => {
    dbAny.providerApplication.findMany.mockResolvedValue([app('b', 'provB', '+27200')])
    dbAny.provider.findMany.mockResolvedValue([
      { id: 'provZ', phone: '+27200', verified: true, status: 'ACTIVE' }, // already-onboarded re-applicant
    ])
    dbAny.providerApplication.groupBy.mockResolvedValue([{ phone: '+27200', _count: { phone: 1 } }])

    const [candidate] = await loadApplicationCandidates({ nowIso: '2026-06-21T16:00:00.000Z' })
    expect(candidate.duplicateSignal).toBe(true)
  })

  it('flags an applicant whose phone appears on more than one application', async () => {
    dbAny.providerApplication.findMany.mockResolvedValue([app('c', 'provC', '+27300')])
    dbAny.provider.findMany.mockResolvedValue([
      { id: 'provC', phone: '+27300', verified: false, status: 'APPLICATION_PENDING' },
    ])
    dbAny.providerApplication.groupBy.mockResolvedValue([{ phone: '+27300', _count: { phone: 2 } }])

    const [candidate] = await loadApplicationCandidates({ nowIso: '2026-06-21T16:00:00.000Z' })
    expect(candidate.duplicateSignal).toBe(true)
  })
})
