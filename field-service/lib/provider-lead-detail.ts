import type {
  LeadStatus,
  LeadUnlockDispute,
  LeadUnlockStatus,
} from '@prisma/client'
import { db } from './db'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import { normaliseLocationDisplayName } from './location-format'

type ProviderLeadDetailErrorCode = 'FORBIDDEN'

export class ProviderLeadDetailError extends Error {
  constructor(
    public readonly code: ProviderLeadDetailErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderLeadDetailError'
  }
}

export type ProviderLeadDetail = {
  id: string
  status: LeadStatus
  sentAt: Date
  expiresAt: Date | null
  unlockCostCredits: number
  isUnlocked: boolean
  provider: {
    id: string
  }
  wallet: {
    paidCredits: number
    promoCredits: number
    totalCredits: number
  }
  unlock: {
    id: string
    status: LeadUnlockStatus
    dispute: LeadUnlockDispute | null
    refundReason: string | null
  } | null
  preview: {
    jobRequestId: string
    category: string
    jobType: string
    area: string
    preferredWindowStart: Date | null
    preferredWindowEnd: Date | null
    requestedArrivalLatest: Date | null
    shortNotes: string | null
    estimatedValue: number | null
    attachments: Array<{
      id: string
      caption: string | null
      label: string | null
    }>
  }
  unlockedDetails: {
    customerName: string
    customerPhone: string
    whatsappHref: string | null
    fullAddress: string
    fullNotes: string
    accessNotes: string | null
    attachments: Array<{
      id: string
      caption: string | null
      label: string | null
    }>
  } | null
}

function formatArea(address: { suburb: string; city: string } | null) {
  return address
    ? [normaliseLocationDisplayName(address.suburb), normaliseLocationDisplayName(address.city)].filter(Boolean).join(', ')
    : 'Area on file'
}

function formatFullAddress(
  address: {
    street: string
    addressLine1: string | null
    addressLine2: string | null
    complexName: string | null
    unitNumber: string | null
    suburb: string
    city: string
    province: string
  } | null,
) {
  if (!address) return 'Location on file'

  return [
    address.unitNumber,
    address.complexName,
    address.street,
    address.addressLine1,
    address.addressLine2,
    normaliseLocationDisplayName(address.suburb),
    normaliseLocationDisplayName(address.city),
    normaliseLocationDisplayName(address.province),
  ].filter(Boolean).join(', ')
}

export function previewNotes(description: string | null | undefined) {
  const trimmed = description?.trim() ?? ''
  if (!trimmed) return null
  return trimmed.length <= 180 ? trimmed : `${trimmed.slice(0, 180).trim()}...`
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

export async function getProviderLeadDetailForProvider(
  leadId: string,
  providerId: string,
): Promise<ProviderLeadDetail | null> {
  const [provider, lead] = await Promise.all([
    db.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        wallet: {
          select: {
            paidCreditBalance: true,
            promoCreditBalance: true,
          },
        },
      },
    }),
    db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        providerId: true,
        status: true,
        sentAt: true,
        expiresAt: true,
        unlock: {
          select: {
            id: true,
            providerId: true,
            status: true,
            refundReason: true,
            dispute: true,
          },
        },
        jobRequest: {
          select: {
            id: true,
            category: true,
            title: true,
            description: true,
            requestedWindowStart: true,
            requestedWindowEnd: true,
            requestedArrivalLatest: true,
            customerAcceptedAmount: true,
            address: {
              select: {
                suburb: true,
                city: true,
              },
            },
            attachments: {
              where: { safeForPreview: true },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                caption: true,
                label: true,
              },
            },
          },
        },
      },
    }),
  ])

  if (!lead) return null
  if (!provider || lead.providerId !== providerId) {
    throw new ProviderLeadDetailError('FORBIDDEN', 'This lead belongs to another provider.')
  }

  const providerUnlock = lead.unlock?.providerId === providerId ? lead.unlock : null
  const isUnlocked = (lead.status === 'ACCEPTED' || lead.status === 'ACCEPTED_LOCKED') && Boolean(providerUnlock)
  const paidCredits = provider.wallet?.paidCreditBalance ?? 0
  const promoCredits = provider.wallet?.promoCreditBalance ?? 0

  let unlockedDetails: ProviderLeadDetail['unlockedDetails'] = null

  if (isUnlocked) {
    // Sensitive customer and exact-location data is fetched only after the
    // server has verified that this provider owns an unlock for the lead.
    const sensitiveLead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        jobRequest: {
          select: {
            description: true,
            customer: { select: { name: true, phone: true } },
            address: {
              select: {
                street: true,
                addressLine1: true,
                addressLine2: true,
                complexName: true,
                unitNumber: true,
                suburb: true,
                city: true,
                province: true,
                accessNotes: true,
              },
            },
            attachments: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                caption: true,
                label: true,
              },
            },
          },
        },
      },
    })

    if (sensitiveLead) {
      unlockedDetails = {
        customerName: sensitiveLead.jobRequest.customer.name,
        customerPhone: sensitiveLead.jobRequest.customer.phone,
        whatsappHref: whatsappHref(sensitiveLead.jobRequest.customer.phone),
        fullAddress: formatFullAddress(sensitiveLead.jobRequest.address),
        fullNotes: sensitiveLead.jobRequest.description,
        accessNotes: sensitiveLead.jobRequest.address?.accessNotes ?? null,
        attachments: sensitiveLead.jobRequest.attachments,
      }
    }
  }

  return {
    id: lead.id,
    status: lead.status,
    sentAt: lead.sentAt,
    expiresAt: lead.expiresAt,
    unlockCostCredits: LEAD_UNLOCK_COST_CREDITS,
    isUnlocked,
    provider: {
      id: provider.id,
    },
    wallet: {
      paidCredits,
      promoCredits,
      totalCredits: paidCredits + promoCredits,
    },
    unlock: providerUnlock
      ? {
          id: providerUnlock.id,
          status: providerUnlock.status,
          dispute: providerUnlock.dispute,
          refundReason: providerUnlock.refundReason,
        }
      : null,
    preview: {
      jobRequestId: lead.jobRequest.id,
      category: lead.jobRequest.category,
      jobType: lead.jobRequest.title,
      area: formatArea(lead.jobRequest.address),
      preferredWindowStart: lead.jobRequest.requestedWindowStart,
      preferredWindowEnd: lead.jobRequest.requestedWindowEnd,
      requestedArrivalLatest: lead.jobRequest.requestedArrivalLatest,
      shortNotes: previewNotes(lead.jobRequest.description),
      estimatedValue: lead.jobRequest.customerAcceptedAmount == null
        ? null
        : Number(lead.jobRequest.customerAcceptedAmount),
      attachments: lead.jobRequest.attachments,
    },
    unlockedDetails,
  }
}
