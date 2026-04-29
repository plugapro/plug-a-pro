import type { LeadStatus } from '@prisma/client'
import { db } from './db'
import { previewNotes } from './provider-lead-detail'

export type ProviderLeadListItem = {
  id: string
  status: LeadStatus
  sentAt: Date
  expiresAt: Date | null
  category: string
  area: string
  shortDescription: string | null
}

function formatArea(address: { suburb: string | null; city: string | null } | null) {
  if (!address) return 'Area in app'
  return [address.suburb, address.city].filter(Boolean).join(', ') || 'Area in app'
}

export async function getProviderLeadListForProvider(providerId: string): Promise<ProviderLeadListItem[]> {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: { isTestUser: true },
  })
  const leads = await db.lead.findMany({
    where: {
      providerId,
      isTestLead: Boolean(provider?.isTestUser),
      status: { in: ['SENT', 'VIEWED'] },
    },
    select: {
      id: true,
      status: true,
      sentAt: true,
      expiresAt: true,
      jobRequest: {
        select: {
          category: true,
          description: true,
          address: {
            select: {
              suburb: true,
              city: true,
            },
          },
        },
      },
    },
    orderBy: { sentAt: 'desc' },
  })

  return leads.map((lead) => ({
    id: lead.id,
    status: lead.status,
    sentAt: lead.sentAt,
    expiresAt: lead.expiresAt,
    category: lead.jobRequest.category,
    area: formatArea(lead.jobRequest.address),
    shortDescription: previewNotes(lead.jobRequest.description),
  }))
}
