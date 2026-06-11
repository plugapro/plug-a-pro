'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { KycCampaignStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { requireAdmin } from '@/lib/auth'
import {
  KYC_FEE_CENTS,
  kycFeeAccruedKey,
  kycFeeReversedKey,
  kycFeeSponsoredKey,
} from '@/lib/kyc-fee/constants'
import { getKycFeeStatus, writeKycFeeLedgerEntryInTransaction } from '@/lib/kyc-fee/ledger'

const FLAG = 'admin.kyc_campaigns'
const PAGE = '/admin/kyc-campaigns'

export type KycCampaignSummary = {
  id: string
  name: string
  campaignCode: string
  status: KycCampaignStatus
  areaLabel: string | null
  areaSlug: string | null
  startsAt: string
  endsAt: string | null
  maxSponsoredCount: number
  consumed: number
  reversed: number
  remaining: number
  createdAt: string
}

export async function listKycCampaignsAction(): Promise<KycCampaignSummary[]> {
  await requireAdmin()
  const [campaigns, grouped] = await Promise.all([
    db.kycCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { locationNode: { select: { label: true, slug: true } } },
    }),
    db.kycSponsorship.groupBy({ by: ['campaignId', 'status'], _count: { id: true } }),
  ])

  const counts = grouped.reduce<Record<string, Record<string, number>>>((acc, row) => {
    if (!acc[row.campaignId]) acc[row.campaignId] = {}
    acc[row.campaignId][row.status] = row._count.id
    return acc
  }, {})

  return campaigns.map((c) => {
    const consumed = counts[c.id]?.['CONSUMED'] ?? 0
    const reversed = counts[c.id]?.['REVERSED'] ?? 0
    return {
      id: c.id,
      name: c.name,
      campaignCode: c.campaignCode,
      status: c.status,
      areaLabel: c.locationNode?.label ?? null,
      areaSlug: c.locationNode?.slug ?? null,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt?.toISOString() ?? null,
      maxSponsoredCount: c.maxSponsoredCount,
      consumed,
      reversed,
      remaining: Math.max(0, c.maxSponsoredCount - consumed),
      createdAt: c.createdAt.toISOString(),
    }
  })
}

const CreateCampaignSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters'),
  campaignCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{3,40}$/, 'Campaign code must be A-Z, 0-9 and underscores'),
  locationNodeSlug: z.string().trim().min(1).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  maxSponsoredCount: z.coerce.number().int().positive().max(100_000),
})

export async function createKycCampaignAction(input: unknown) {
  const admin = await requireAdmin()
  const result = await crudAction<z.infer<typeof CreateCampaignSchema>, { id: string }>({
    entity: 'KycCampaign',
    action: 'kyc_campaign.create',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: CreateCampaignSchema,
    input,
    run: async (data, tx) => {
      let locationNodeId: string | null = null
      if (data.locationNodeSlug) {
        const node = await tx.locationNode.findUnique({
          where: { slug: data.locationNodeSlug },
          select: { id: true },
        })
        if (!node) {
          throw new CrudActionError('NOT_FOUND', `No location node with slug '${data.locationNodeSlug}'`)
        }
        locationNodeId = node.id
      }
      const duplicate = await tx.kycCampaign.findUnique({
        where: { campaignCode: data.campaignCode },
        select: { id: true },
      })
      if (duplicate) {
        throw new CrudActionError('CONFLICT', `Campaign code '${data.campaignCode}' already exists`)
      }
      if (data.endsAt && data.endsAt <= data.startsAt) {
        throw new CrudActionError('VALIDATION', 'endsAt must be after startsAt')
      }
      const adminUser = await tx.adminUser.findUnique({
        where: { userId: admin.id },
        select: { id: true },
      })
      if (!adminUser) throw new CrudActionError('UNAUTHORIZED', 'Admin user record not found')
      return tx.kycCampaign.create({
        data: {
          name: data.name,
          campaignCode: data.campaignCode,
          locationNodeId,
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          maxSponsoredCount: data.maxSponsoredCount,
          createdById: adminUser.id,
        },
        select: { id: true },
      })
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

const ALLOWED_STATUS_TRANSITIONS: Record<KycCampaignStatus, KycCampaignStatus[]> = {
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
}

const SetStatusSchema = z.object({
  campaignId: z.string().min(1),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']),
})

export async function setKycCampaignStatusAction(input: unknown) {
  const result = await crudAction<z.infer<typeof SetStatusSchema>, { id: string; status: string }>({
    entity: 'KycCampaign',
    action: 'kyc_campaign.set_status',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: SetStatusSchema,
    input,
    run: async (data, tx) => {
      const campaign = await tx.kycCampaign.findUnique({
        where: { id: data.campaignId },
        select: { id: true, status: true },
      })
      if (!campaign) throw new CrudActionError('NOT_FOUND', 'Campaign not found')
      if (!ALLOWED_STATUS_TRANSITIONS[campaign.status].includes(data.status)) {
        throw new CrudActionError('CONFLICT', `Cannot move campaign from ${campaign.status} to ${data.status}`)
      }
      return tx.kycCampaign.update({
        where: { id: data.campaignId },
        data: { status: data.status },
        select: { id: true, status: true },
      })
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

const GrantSchema = z.object({
  campaignId: z.string().min(1),
  providerId: z.string().min(1),
  reason: z.string().trim().min(5, 'A justification of at least 5 characters is required'),
})

export async function grantKycSponsorshipAction(input: unknown) {
  const admin = await requireAdmin()
  if (!admin.adminUserId) {
    throw new CrudActionError('UNAUTHORIZED', 'No AdminUser record for the current session.')
  }
  const actorId = admin.adminUserId
  const result = await crudAction<z.infer<typeof GrantSchema>, { id: string }>({
    entity: 'KycSponsorship',
    action: 'kyc_sponsorship.grant',
    requiredRole: ['TRUST'],
    requiredFlag: FLAG,
    schema: GrantSchema,
    input,
    reason: (input as { reason?: string })?.reason,
    run: async (data, tx) => {
      const provider = await tx.provider.findUnique({
        where: { id: data.providerId },
        select: { id: true, kycStatus: true },
      })
      if (!provider) throw new CrudActionError('NOT_FOUND', 'Provider not found')
      if (provider.kycStatus !== 'VERIFIED') {
        throw new CrudActionError('CONFLICT', 'Provider must be KYC-verified before sponsoring')
      }
      const campaign = await tx.kycCampaign.findUnique({ where: { id: data.campaignId } })
      if (!campaign) throw new CrudActionError('NOT_FOUND', 'Campaign not found')
      if (campaign.status === 'DRAFT') {
        throw new CrudActionError('CONFLICT', 'Activate the campaign before granting sponsorships')
      }
      const existing = await tx.kycSponsorship.findUnique({
        where: { campaignId_providerId: { campaignId: data.campaignId, providerId: data.providerId } },
        select: { id: true },
      })
      if (existing) {
        throw new CrudActionError('CONFLICT', 'Provider already has a sponsorship on this campaign')
      }

      const verification = await tx.providerIdentityVerification.findFirst({
        where: { providerId: data.providerId, status: 'PASSED', decision: 'PASS' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, identifierHash: true },
      })

      const feeStatus = await getKycFeeStatus(data.providerId, tx)
      if (feeStatus.lastReason !== null && feeStatus.outstandingCents === 0) {
        throw new CrudActionError('CONFLICT', 'Provider has no outstanding KYC fee to sponsor')
      }
      if (feeStatus.lastReason === null) {
        // Provider verified before the fee model launched - book the accrual now.
        await writeKycFeeLedgerEntryInTransaction(tx, {
          providerId: data.providerId,
          reason: 'KYC_FEE_ACCRUED',
          amountCents: KYC_FEE_CENTS,
          referenceType: verification ? 'provider_identity_verification' : 'provider',
          referenceId: verification?.id ?? data.providerId,
          idempotencyKey: kycFeeAccruedKey(data.providerId),
          source: 'admin',
          createdBy: actorId,
          description: 'Once-off ID verification recovery fee (booked at manual sponsorship)',
        })
      }

      // Sponsor what the provider actually owes. For a fresh accrual that is
      // KYC_FEE_CENTS; for a pre-existing balance (fee constant changed, or
      // accrue->sponsor->revoke history) it is the outstanding amount.
      const sponsorCents =
        feeStatus.lastReason === null ? KYC_FEE_CENTS : feeStatus.outstandingCents

      const claimed = await tx.kycCampaign.updateMany({
        where: { id: campaign.id, sponsoredCount: { lt: campaign.maxSponsoredCount } },
        data: { sponsoredCount: { increment: 1 } },
      })
      if (claimed.count === 0) {
        throw new CrudActionError('CONFLICT', 'Campaign allocation is exhausted - raise the max sponsored count first')
      }

      const sponsorship = await tx.kycSponsorship.create({
        data: {
          campaignId: campaign.id,
          providerId: data.providerId,
          status: 'CONSUMED',
          source: 'admin',
          feeCents: sponsorCents,
          reason: data.reason,
          verificationId: verification?.id ?? null,
          identifierHash: verification?.identifierHash ?? null,
        },
        select: { id: true },
      })

      await writeKycFeeLedgerEntryInTransaction(tx, {
        providerId: data.providerId,
        reason: 'KYC_FEE_SPONSORED',
        amountCents: sponsorCents,
        referenceType: 'kyc_sponsorship',
        referenceId: sponsorship.id,
        campaignId: campaign.id,
        idempotencyKey: kycFeeSponsoredKey(sponsorship.id),
        source: 'admin',
        createdBy: actorId,
        description: `Manually sponsored by admin under campaign ${campaign.campaignCode}: ${data.reason}`,
      })

      return sponsorship
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

const RevokeSchema = z.object({
  sponsorshipId: z.string().min(1),
  reason: z.string().trim().min(5, 'A justification of at least 5 characters is required'),
})

export async function revokeKycSponsorshipAction(input: unknown) {
  const admin = await requireAdmin()
  if (!admin.adminUserId) {
    throw new CrudActionError('UNAUTHORIZED', 'No AdminUser record for the current session.')
  }
  const actorId = admin.adminUserId
  const result = await crudAction<z.infer<typeof RevokeSchema>, { id: string }>({
    entity: 'KycSponsorship',
    action: 'kyc_sponsorship.revoke',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: RevokeSchema,
    input,
    reason: (input as { reason?: string })?.reason,
    run: async (data, tx) => {
      const sponsorship = await tx.kycSponsorship.findUnique({
        where: { id: data.sponsorshipId },
      })
      if (!sponsorship) throw new CrudActionError('NOT_FOUND', 'Sponsorship not found')
      if (sponsorship.status !== 'CONSUMED') {
        throw new CrudActionError('CONFLICT', 'Only CONSUMED sponsorships can be revoked')
      }

      const updated = await tx.kycSponsorship.update({
        where: { id: sponsorship.id },
        data: {
          status: 'REVERSED',
          revokedAt: new Date(),
          revokedById: actorId,
          reason: data.reason,
        },
        select: { id: true },
      })

      await writeKycFeeLedgerEntryInTransaction(tx, {
        providerId: sponsorship.providerId,
        reason: 'KYC_FEE_REVERSED',
        amountCents: sponsorship.feeCents,
        referenceType: 'kyc_sponsorship',
        referenceId: sponsorship.id,
        campaignId: sponsorship.campaignId,
        idempotencyKey: kycFeeReversedKey(sponsorship.id),
        source: 'admin',
        createdBy: actorId,
        description: `Sponsorship revoked: ${data.reason}`,
      })

      await tx.kycCampaign.updateMany({
        where: { id: sponsorship.campaignId, sponsoredCount: { gt: 0 } },
        data: { sponsoredCount: { decrement: 1 } },
      })

      return updated
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

// ─── Form wrappers (page <form action={…}>) ──────────────────────────────────

export async function createKycCampaignFromFormAction(formData: FormData): Promise<void> {
  try {
    await createKycCampaignAction({
      name: formData.get('name'),
      campaignCode: formData.get('campaignCode'),
      locationNodeSlug: (formData.get('locationNodeSlug') as string)?.trim() || undefined,
      startsAt: (formData.get('startsAt') as string)?.trim() || undefined,
      endsAt: (formData.get('endsAt') as string)?.trim() || undefined,
      maxSponsoredCount: formData.get('maxSponsoredCount'),
    })
  } catch (err) {
    const msg = err instanceof CrudActionError ? err.message : 'Failed to create campaign'
    console.error('[kyc-campaigns] createKycCampaign error:', msg)
  }
}

export async function setKycCampaignStatusFromFormAction(formData: FormData): Promise<void> {
  try {
    await setKycCampaignStatusAction({
      campaignId: formData.get('campaignId'),
      status: formData.get('status'),
    })
  } catch (err) {
    const msg = err instanceof CrudActionError ? err.message : 'Failed to update campaign status'
    console.error('[kyc-campaigns] setKycCampaignStatus error:', msg)
  }
}

export async function grantKycSponsorshipFromFormAction(formData: FormData): Promise<void> {
  try {
    await grantKycSponsorshipAction({
      campaignId: formData.get('campaignId'),
      providerId: formData.get('providerId'),
      reason: formData.get('reason'),
    })
  } catch (err) {
    const msg = err instanceof CrudActionError ? err.message : 'Failed to grant sponsorship'
    console.error('[kyc-campaigns] grantKycSponsorship error:', msg)
  }
}

export async function revokeKycSponsorshipFromFormAction(formData: FormData): Promise<void> {
  try {
    await revokeKycSponsorshipAction({
      sponsorshipId: formData.get('sponsorshipId'),
      reason: formData.get('reason'),
    })
  } catch (err) {
    const msg = err instanceof CrudActionError ? err.message : 'Failed to revoke sponsorship'
    console.error('[kyc-campaigns] revokeKycSponsorship error:', msg)
  }
}
