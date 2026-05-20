import { type JobRequestStatus, type LeadStatus } from '@prisma/client'
import { db } from './db'

export type LeadWithJobRequest = {
  id: string
  status: LeadStatus
  providerId: string
  jobRequestId: string
  expiresAt: Date | null
  jobRequest: {
    id: string
    category: string
    status: JobRequestStatus
  }
}

export interface LeadRepository {
  findLeadWithJobRequest(leadId: string): Promise<LeadWithJobRequest | null>
}

export function createPrismaLeadRepository(): LeadRepository {
  return {
    async findLeadWithJobRequest(leadId) {
      return db.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          status: true,
          providerId: true,
          jobRequestId: true,
          expiresAt: true,
          jobRequest: {
            select: {
              id: true,
              category: true,
              status: true,
            },
          },
        },
      })
    },
  }
}

export function createInMemoryLeadRepository(seed: LeadWithJobRequest[]): LeadRepository {
  const store = new Map(seed.map((l) => [l.id, l]))
  return {
    async findLeadWithJobRequest(leadId) {
      return store.get(leadId) ?? null
    },
  }
}
