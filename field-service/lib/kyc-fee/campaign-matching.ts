import type { LocationNodeType, Prisma } from '@prisma/client'

export type CampaignMatchTx = Pick<
  Prisma.TransactionClient,
  'kycCampaign' | 'technicianServiceArea' | 'provider'
>

export type CampaignAreaNode = {
  nodeType: LocationNodeType
  slug: string
}

// LocationNode slugs are hierarchical: {province}__{city}__{region}__{suburb}.
// TechnicianServiceArea denormalises one key column per level; the node's own
// key is the last slug segment (same rule as upsertStructuredServiceAreas in
// lib/provider-record.ts).
export function campaignAreaKey(node: CampaignAreaNode): {
  field: 'provinceKey' | 'cityKey' | 'regionKey' | 'suburbKey'
  key: string
} {
  const key = node.slug.split('__').at(-1) ?? node.slug
  switch (node.nodeType) {
    case 'PROVINCE':
      return { field: 'provinceKey', key }
    case 'CITY':
      return { field: 'cityKey', key }
    case 'REGION':
      return { field: 'regionKey', key }
    case 'SUBURB':
      return { field: 'suburbKey', key }
  }
}

export function legacyServiceAreaMatches(
  serviceAreas: string[],
  campaignNodeSlug: string,
): boolean {
  return serviceAreas.some(
    (entry) => entry === campaignNodeSlug || entry.startsWith(`${campaignNodeSlug}__`),
  )
}

/**
 * A provider matches when ANY of their areas falls inside the campaign scope:
 * structured TechnicianServiceArea key match first, legacy free-text slug
 * match as fallback (WhatsApp-onboarded providers have no TSA rows).
 * Deliberately does NOT filter TSA.active — campaigns may target areas that
 * are not yet flipped to 'active' pilot regions.
 */
export async function providerMatchesCampaignArea(
  tx: CampaignMatchTx,
  providerId: string,
  node: CampaignAreaNode | null,
): Promise<boolean> {
  if (!node) return true // global campaign

  const { field, key } = campaignAreaKey(node)
  const structured = await tx.technicianServiceArea.findFirst({
    where: { providerId, [field]: key },
    select: { id: true },
  })
  if (structured) return true

  const provider = await tx.provider.findUnique({
    where: { id: providerId },
    select: { serviceAreas: true },
  })
  return legacyServiceAreaMatches(provider?.serviceAreas ?? [], node.slug)
}

// Derive the campaign shape from the query itself to avoid type narrowing
// conflicts between KycCampaign (no relations) and the include result.
async function _queryCampaigns(tx: CampaignMatchTx, now: Date) {
  return tx.kycCampaign.findMany({
    where: {
      status: 'ACTIVE',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: { locationNode: { select: { nodeType: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export type EligibleCampaign = Awaited<ReturnType<typeof _queryCampaigns>>[number]

/**
 * First ACTIVE, in-window, under-cap campaign whose area matches the
 * provider. Oldest campaign wins when several match.
 */
export async function findEligibleCampaign(
  tx: CampaignMatchTx,
  providerId: string,
  now: Date = new Date(),
): Promise<EligibleCampaign | null> {
  const campaigns = await _queryCampaigns(tx, now)

  for (const campaign of campaigns) {
    if (campaign.sponsoredCount >= campaign.maxSponsoredCount) continue
    if (await providerMatchesCampaignArea(tx, providerId, campaign.locationNode)) {
      return campaign
    }
  }
  return null
}
