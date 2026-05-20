import { describe, it, expect } from 'vitest'
import { type LeadWithJobRequest, createInMemoryLeadRepository } from '@/lib/lead-repository'
import { JobRequestStatus, LeadStatus } from '@prisma/client'

const stubLead: LeadWithJobRequest = {
  id: 'lead-1',
  providerId: 'prov-1',
  jobRequestId: 'req-1',
  status: LeadStatus.SENT,
  expiresAt: null,
  jobRequest: {
    id: 'req-1',
    category: 'plumbing',
    status: JobRequestStatus.MATCHING,
  },
}

describe('createInMemoryLeadRepository', () => {
  it('returns a lead by id', async () => {
    const repo = createInMemoryLeadRepository([stubLead])
    const found = await repo.findLeadWithJobRequest('lead-1')
    expect(found?.id).toBe('lead-1')
  })

  it('returns null for an unknown id', async () => {
    const repo = createInMemoryLeadRepository([])
    expect(await repo.findLeadWithJobRequest('nonexistent')).toBeNull()
  })

  it('returns null from an empty repo (type-safe stub)', async () => {
    const repo = createInMemoryLeadRepository([])
    // TypeScript compile error here would mean the interface is broken
    const _typed: import('@/lib/lead-repository').LeadRepository = repo
    expect(await _typed.findLeadWithJobRequest('any-id')).toBeNull()
  })
})
