import { db } from '@/lib/db'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { locationSearchTerms } from '@/lib/location-aliases'
import { LocationNodeType, LocationNode } from '@prisma/client'

// ─── Exported Types ────────────────────────────────────────────────────────────

export type ProvinceOption = {
  id: string
  slug: string
  label: string
}

export type CityOption = {
  id: string
  slug: string
  label: string
  provinceKey: string
  cityKey: string
}

export type RegionOption = {
  id: string
  slug: string
  label: string
  provinceKey: string
  cityKey: string
  regionKey: string
  lat: number | null
  lng: number | null
  radiusKm: number | null
  suburbCount?: number
}

export type SuburbOption = {
  id: string
  slug: string
  label: string
  regionLabel: string
  cityLabel: string
  provinceLabel: string
  postalCode: string
  provinceKey: string
  cityKey: string
  regionKey: string
  lat: number | null
  lng: number | null
}

export type StructuredAddressSelection = {
  locationNodeId: string
  suburb: string
  region: string
  city: string
  province: string
  postalCode: string
}

export type NodeSearchResult = {
  id: string
  slug: string
  label: string
  nodeType: LocationNodeType
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
}

export class LocationNodeInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocationNodeInUseError'
  }
}

const STRUCTURED_ADDRESS_EXCLUDED_SUBURB_SLUGS = [
  'gauteng__east_rand__east_rand__ekurhuleni',
  'gauteng__johannesburg__jhb_cbd__joburg_cbd',
  'gauteng__johannesburg__jhb_cbd__johannesburg',
  'gauteng__johannesburg__jhb_cbd__johannesburg_cbd',
  'gauteng__johannesburg__jhb_south__joburg_south',
  'gauteng__johannesburg__jhb_south__johannesburg_south',
  'gauteng__johannesburg__jhb_west__joburg_west',
  'gauteng__johannesburg__jhb_west__johannesburg_west',
  'gauteng__pretoria__pretoria_cbd__pretoria',
  'gauteng__pretoria__pretoria_cbd__pretoria_cbd',
  'gauteng__pretoria__pretoria_east__pretoria_east',
  'kwazulu_natal__durban__durban_cbd__durban',
  'kwazulu_natal__durban__durban_cbd__durban_cbd',
  'western_cape__cape_town__cape_town_cbd__cape_town',
  'western_cape__cape_town__cape_town_cbd__cape_town_cbd',
] as const

// Re-export Prisma types for consumers
export type { LocationNode, LocationNodeType }

// ─── Helpers ────────────────────────────────────────────────────────────────────

const formatNodeLabel = normaliseLocationDisplayName

// ─── Read Functions ────────────────────────────────────────────────────────────

/**
 * Returns all active PROVINCE nodes, ordered by label.
 * Use the node slug as the provinceKey when filtering cities.
 */
export async function getProvinces(): Promise<ProvinceOption[]> {
  const nodes = await db.locationNode.findMany({
    where: { nodeType: 'PROVINCE', active: true },
    orderBy: { label: 'asc' },
    select: { id: true, slug: true, label: true },
  })
  return nodes.map((n) => ({ id: n.id, slug: n.slug, label: formatNodeLabel(n.label) }))
}

/**
 * Returns all active CITY nodes, optionally filtered by provinceKey.
 */
export async function getCities(provinceKey?: string): Promise<CityOption[]> {
  const nodes = await db.locationNode.findMany({
    where: {
      nodeType: 'CITY',
      active: true,
      ...(provinceKey ? { provinceKey } : {}),
    },
    orderBy: { label: 'asc' },
    select: { id: true, slug: true, label: true, provinceKey: true, cityKey: true },
  })

  return nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    label: formatNodeLabel(n.label),
    provinceKey: n.provinceKey ?? '',
    cityKey: n.cityKey ?? '',
  }))
}

/**
 * Returns all active REGION nodes for a given city node ID.
 */
export async function getRegions(cityId: string): Promise<RegionOption[]> {
  // Resolve the cityKey from the city node
  const cityNode = await db.locationNode.findUnique({
    where: { id: cityId },
    select: { cityKey: true, provinceKey: true },
  })

  if (!cityNode?.cityKey) return []

  const nodes = await db.locationNode.findMany({
    where: {
      nodeType: 'REGION',
      active: true,
      cityKey: cityNode.cityKey,
    },
    orderBy: { label: 'asc' },
    select: {
      id: true,
      slug: true,
      label: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      lat: true,
      lng: true,
      radiusKm: true,
      _count: { select: { children: true } },
    },
  })

  return nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    label: formatNodeLabel(n.label),
    provinceKey: n.provinceKey ?? '',
    cityKey: n.cityKey ?? '',
    regionKey: n.regionKey ?? '',
    lat: n.lat,
    lng: n.lng,
    radiusKm: n.radiusKm,
    suburbCount: n._count.children,
  }))
}

/**
 * Returns all active SUBURB nodes for a given region node ID.
 */
export async function getSuburbs(regionId: string): Promise<SuburbOption[]> {
  const nodes = await db.locationNode.findMany({
    where: {
      nodeType: 'SUBURB',
      active: true,
      parentId: regionId,
      postalCode: { not: null },
      slug: { notIn: [...STRUCTURED_ADDRESS_EXCLUDED_SUBURB_SLUGS] },
    },
    orderBy: { label: 'asc' },
    select: {
      id: true,
      slug: true,
      label: true,
      postalCode: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      lat: true,
      lng: true,
      parent: {
        select: {
          label: true,
          parent: {
            select: {
              label: true,
              parent: {
                select: { label: true },
              },
            },
          },
        },
      },
    },
  })

  return nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    label: formatNodeLabel(n.label),
    regionLabel: formatNodeLabel(n.parent?.label ?? ''),
    cityLabel: formatNodeLabel(n.parent?.parent?.label ?? ''),
    provinceLabel: formatNodeLabel(n.parent?.parent?.parent?.label ?? ''),
    postalCode: n.postalCode ?? '',
    provinceKey: n.provinceKey ?? '',
    cityKey: n.cityKey ?? '',
    regionKey: n.regionKey ?? '',
    lat: n.lat,
    lng: n.lng,
  }))
}

/**
 * Full-text search on label for SUBURB and REGION nodes.
 * Optional provinceKey narrows the search. Max 20 results.
 * Throws if query is shorter than 2 characters.
 */
export async function searchNodes(
  q: string,
  provinceKey?: string,
): Promise<NodeSearchResult[]> {
  if (q.length < 2) {
    throw new Error('Search query must be at least 2 characters')
  }

  const terms = locationSearchTerms(q)
  const nodes = await db.locationNode.findMany({
    where: {
      active: true,
      nodeType: { in: ['SUBURB', 'REGION'] },
      OR: terms.map((term) => ({ label: { contains: term, mode: 'insensitive' as const } })),
      ...(provinceKey ? { provinceKey } : {}),
    },
    orderBy: { label: 'asc' },
    take: 20,
    select: {
      id: true,
      slug: true,
      label: true,
      nodeType: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
    },
  })

  return nodes.map((node) => ({
    ...node,
    label: formatNodeLabel(node.label),
  }))
}

/**
 * Suburb-only full-text search for the booking combobox.
 * Returns SUBURB nodes only (not REGION), with all parent labels and postalCode
 * so the caller can populate the SuburbPicker.Selection interface directly.
 * The existing searchNodes() function is preserved for other callers.
 */
export async function searchSuburbNodes(
  q: string,
  provinceKey?: string,
): Promise<SuburbOption[]> {
  if (q.length < 2) {
    throw new Error('Search query must be at least 2 characters')
  }

  const terms = locationSearchTerms(q)
  const nodes = await db.locationNode.findMany({
    where: {
      active: true,
      nodeType: 'SUBURB',
      OR: terms.map((term) => ({ label: { contains: term, mode: 'insensitive' as const } })),
      ...(provinceKey ? { provinceKey } : {}),
    },
    orderBy: { label: 'asc' },
    take: 20,
    select: {
      id: true,
      slug: true,
      label: true,
      postalCode: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      lat: true,
      lng: true,
      parent: {
        select: {
          label: true,
          parent: {
            select: {
              label: true,
              parent: {
                select: { label: true },
              },
            },
          },
        },
      },
    },
  })

  return nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    label: formatNodeLabel(n.label),
    regionLabel: formatNodeLabel(n.parent?.label ?? ''),
    cityLabel: formatNodeLabel(n.parent?.parent?.label ?? ''),
    provinceLabel: formatNodeLabel(n.parent?.parent?.parent?.label ?? ''),
    postalCode: n.postalCode ?? '',
    provinceKey: n.provinceKey ?? '',
    cityKey: n.cityKey ?? '',
    regionKey: n.regionKey ?? '',
    lat: n.lat,
    lng: n.lng,
  }))
}

/**
 * Resolve a raw suburb string to a locationNodeId via case-insensitive label match.
 * Optional city filter narrows the search by cityKey.
 * Returns the node id if found, null otherwise.
 */
export async function resolveSuburbNodeId(
  suburb: string,
  city?: string,
): Promise<string | null> {
  if (!db.locationNode?.findFirst) {
    return null
  }

  const node = await db.locationNode.findFirst({
    where: {
      label: { equals: suburb, mode: 'insensitive' },
      nodeType: 'SUBURB',
      active: true,
      ...(city ? { cityKey: { equals: city, mode: 'insensitive' } } : {}),
    },
    select: { id: true },
  })

  return node?.id ?? null
}

export async function getStructuredAddressSelection(
  locationNodeId: string,
): Promise<StructuredAddressSelection | null> {
  const node = await db.locationNode.findFirst({
    where: {
      id: locationNodeId,
      nodeType: 'SUBURB',
      active: true,
      postalCode: { not: null },
      slug: { notIn: [...STRUCTURED_ADDRESS_EXCLUDED_SUBURB_SLUGS] },
    },
    select: {
      id: true,
      label: true,
      postalCode: true,
      parent: {
        select: {
          label: true,
          parent: {
            select: {
              label: true,
              parent: {
                select: { label: true },
              },
            },
          },
        },
      },
    },
  })

  if (
    !node ||
    !node.postalCode ||
    !node.parent?.label ||
    !node.parent.parent?.label ||
    !node.parent.parent.parent?.label
  ) {
    return null
  }

  return {
    locationNodeId: node.id,
    suburb: formatNodeLabel(node.label),
    region: formatNodeLabel(node.parent.label),
    city: formatNodeLabel(node.parent.parent.label),
    province: formatNodeLabel(node.parent.parent.parent.label),
    postalCode: node.postalCode,
  }
}

/**
 * Confirms that a SUBURB node is a direct child of the given REGION node.
 * Used to reject spoofed WhatsApp `sub__<id>` list-row ids that point at a suburb
 * outside the region the customer previously confirmed (finding 3cc92366).
 * Returns false when either id is missing, the suburb is inactive, or the suburb's
 * parentId does not match the expected region id.
 */
export async function isSuburbChildOfRegion(
  suburbNodeId: string | null | undefined,
  regionNodeId: string | null | undefined,
): Promise<boolean> {
  const suburbId = suburbNodeId?.trim()
  const regionId = regionNodeId?.trim()
  if (!suburbId || !regionId) return false

  const node = await db.locationNode.findFirst({
    where: { id: suburbId, nodeType: 'SUBURB', active: true },
    select: { parentId: true },
  })

  return node?.parentId === regionId
}

export async function getStructuredAddressSelectionBySlug(
  slug: string,
): Promise<StructuredAddressSelection | null> {
  const node = await db.locationNode.findFirst({
    where: {
      slug,
      nodeType: 'SUBURB',
      active: true,
      postalCode: { not: null },
    },
    select: {
      id: true,
      label: true,
      postalCode: true,
      parent: {
        select: {
          label: true,
          parent: {
            select: {
              label: true,
              parent: {
                select: { label: true },
              },
            },
          },
        },
      },
    },
  })

  if (
    !node ||
    !node.postalCode ||
    !node.parent?.label ||
    !node.parent.parent?.label ||
    !node.parent.parent.parent?.label
  ) {
    return null
  }

  return {
    locationNodeId: node.id,
    suburb: formatNodeLabel(node.label),
    region: formatNodeLabel(node.parent.label),
    city: formatNodeLabel(node.parent.parent.label),
    province: formatNodeLabel(node.parent.parent.parent.label),
    postalCode: node.postalCode,
  }
}

export async function resolveStructuredAddressByLabels(input: {
  suburb: string
  city?: string | null
  province?: string | null
}): Promise<StructuredAddressSelection | null> {
  const nodes = await db.locationNode.findMany({
    where: {
      nodeType: 'SUBURB',
      active: true,
      postalCode: { not: null },
      slug: { notIn: [...STRUCTURED_ADDRESS_EXCLUDED_SUBURB_SLUGS] },
      label: { equals: input.suburb.trim(), mode: 'insensitive' },
    },
    select: {
      id: true,
      label: true,
      postalCode: true,
      parent: {
        select: {
          label: true,
          parent: {
            select: {
              label: true,
              parent: {
                select: { label: true },
              },
            },
          },
        },
      },
    },
  })

  const node = nodes.find((candidate) => {
    const matchesCity = input.city
      ? candidate.parent?.parent?.label?.toLowerCase() === input.city.trim().toLowerCase()
      : true
    const matchesProvince = input.province
      ? candidate.parent?.parent?.parent?.label?.toLowerCase() === input.province.trim().toLowerCase()
      : true
    return matchesCity && matchesProvince
  }) ?? null

  if (
    !node ||
    !node.postalCode ||
    !node.parent?.label ||
    !node.parent.parent?.label ||
    !node.parent.parent.parent?.label
  ) {
    return null
  }

  return {
    locationNodeId: node.id,
    suburb: formatNodeLabel(node.label),
    region: formatNodeLabel(node.parent.label),
    city: formatNodeLabel(node.parent.parent.label),
    province: formatNodeLabel(node.parent.parent.parent.label),
    postalCode: node.postalCode,
  }
}

/**
 * Get a single node by ID (any type).
 */
export async function getLocationNode(id: string): Promise<LocationNode | null> {
  const node = await db.locationNode.findUnique({ where: { id } })
  return node ? { ...node, label: formatNodeLabel(node.label) } : null
}

/**
 * List nodes with optional filters (used by admin).
 */
export async function listLocationNodes(filter?: {
  nodeType?: LocationNodeType
  provinceKey?: string
  cityKey?: string
  regionKey?: string
  active?: boolean
}): Promise<LocationNode[]> {
  const nodes = await db.locationNode.findMany({
    where: {
      ...(filter?.nodeType !== undefined ? { nodeType: filter.nodeType } : {}),
      ...(filter?.provinceKey !== undefined ? { provinceKey: filter.provinceKey } : {}),
      ...(filter?.cityKey !== undefined ? { cityKey: filter.cityKey } : {}),
      ...(filter?.regionKey !== undefined ? { regionKey: filter.regionKey } : {}),
      ...(filter?.active !== undefined ? { active: filter.active } : {}),
    },
    orderBy: [{ nodeType: 'asc' }, { label: 'asc' }],
  })
  return nodes.map((node) => ({ ...node, label: formatNodeLabel(node.label) }))
}

// ─── Write Functions (Admin CRUD) ──────────────────────────────────────────────

/**
 * Create a new node. Validates parent type matches expected hierarchy.
 * PROVINCE: parentId must be null
 * CITY: parentId must point to a PROVINCE node
 * REGION: parentId must point to a CITY node
 * SUBURB: parentId must point to a REGION node
 */
export async function createLocationNode(data: {
  nodeType: LocationNodeType
  slug: string
  label: string
  parentId: string | null
  lat?: number
  lng?: number
  radiusKm?: number
  provinceKey?: string
  cityKey?: string
  regionKey?: string
}): Promise<LocationNode> {
  // Validate parent type alignment
  if (data.nodeType === 'PROVINCE') {
    if (data.parentId !== null) {
      throw new Error('PROVINCE nodes must have parentId = null')
    }
  } else {
    if (!data.parentId) {
      throw new Error(`${data.nodeType} nodes require a parentId`)
    }

    const parent = await db.locationNode.findUnique({
      where: { id: data.parentId },
      select: { nodeType: true },
    })

    if (!parent) {
      throw new Error(`Parent node ${data.parentId} not found`)
    }

    const expectedParentType: Record<string, LocationNodeType> = {
      CITY: 'PROVINCE',
      REGION: 'CITY',
      SUBURB: 'REGION',
    }

    const expected = expectedParentType[data.nodeType]
    if (parent.nodeType !== expected) {
      throw new Error(
        `${data.nodeType} requires a ${expected} parent, got ${parent.nodeType}`,
      )
    }
  }

  return db.locationNode.create({
    data: {
      nodeType: data.nodeType,
      slug: data.slug,
      label: formatNodeLabel(data.label),
      parentId: data.parentId,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      radiusKm: data.radiusKm ?? null,
      provinceKey: data.provinceKey ?? null,
      cityKey: data.cityKey ?? null,
      regionKey: data.regionKey ?? null,
    },
  })
}

/**
 * Update mutable fields. Slug is intentionally NOT updateable.
 */
export async function updateLocationNode(
  id: string,
  data: {
    label?: string
    lat?: number | null
    lng?: number | null
    radiusKm?: number | null
    active?: boolean
  },
): Promise<LocationNode> {
  return db.locationNode.update({
    where: { id },
    data: {
      ...(data.label !== undefined ? { label: formatNodeLabel(data.label) } : {}),
      ...(data.lat !== undefined ? { lat: data.lat } : {}),
      ...(data.lng !== undefined ? { lng: data.lng } : {}),
      ...(data.radiusKm !== undefined ? { radiusKm: data.radiusKm } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  })
}

/**
 * Soft-delete: sets active = false.
 * Call this first - never hard-delete a node that has references.
 */
export async function deactivateLocationNode(id: string): Promise<void> {
  await db.locationNode.update({
    where: { id },
    data: { active: false },
  })
}

/**
 * Hard delete - only allowed if:
 * - node has no children
 * - node has no FK references in addresses.locationNodeId
 * - node has no FK references in technician_service_areas.locationNodeId
 * Throws LocationNodeInUseError if any references exist.
 */
export async function deleteLocationNode(id: string): Promise<void> {
  if (process.env.ALLOW_LOCATION_HARD_DELETE !== 'true') {
    await deactivateLocationNode(id)
    return
  }

  const [childCount, addressCount, serviceAreaCount] = await Promise.all([
    db.locationNode.count({ where: { parentId: id } }),
    db.address.count({ where: { locationNodeId: id } }),
    db.technicianServiceArea.count({ where: { locationNodeId: id } }),
  ])

  if (childCount > 0) {
    throw new LocationNodeInUseError(
      `Cannot delete node ${id}: it has ${childCount} child node(s)`,
    )
  }
  if (addressCount > 0) {
    throw new LocationNodeInUseError(
      `Cannot delete node ${id}: referenced by ${addressCount} address(es)`,
    )
  }
  if (serviceAreaCount > 0) {
    throw new LocationNodeInUseError(
      `Cannot delete node ${id}: referenced by ${serviceAreaCount} technician service area(s)`,
    )
  }

  await db.locationNode.delete({ where: { id } })
}
