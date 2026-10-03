// Builds TechnicianServiceArea rows for the provider self-service area picker.
//
// SUBURB rows carry a suburbKey (last slug segment). REGION rows ("cover the
// whole region") carry areaType REGION and a regionKey from the node or its
// slug. Rows are always active: liveness is a property of the location node,
// not of the row. CITY / PROVINCE nodes are never valid service areas.
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { getRegionKeyFromSlug } from '@/lib/service-area-guard'

export type ServiceAreaNodeInput = {
  id: string
  slug: string
  label: string
  nodeType: string
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
}

export type TechnicianServiceAreaRow = {
  providerId: string
  locationNodeId: string
  areaType: 'SUBURB' | 'REGION'
  label: string
  provinceKey: string | null
  cityKey: string | null
  regionKey: string | null
  suburbKey: string | null
  active: true
}

export class InvalidServiceAreaNodeError extends Error {
  constructor(rejected: ServiceAreaNodeInput[]) {
    super(
      `Invalid service area selection: only SUBURB and REGION nodes are permitted. Rejected node types: ${rejected
        .map((node) => `${node.id}(${node.nodeType})`)
        .join(', ')}`,
    )
    this.name = 'InvalidServiceAreaNodeError'
  }
}

export function buildTechnicianServiceAreaRows(
  providerId: string,
  nodes: ServiceAreaNodeInput[],
): TechnicianServiceAreaRow[] {
  const rejected = nodes.filter((node) => node.nodeType !== 'SUBURB' && node.nodeType !== 'REGION')
  if (rejected.length > 0) throw new InvalidServiceAreaNodeError(rejected)

  return nodes.map((node) => {
    const isSuburb = node.nodeType === 'SUBURB'
    const derivedRegionKey = isSuburb ? null : getRegionKeyFromSlug(node.slug) || null
    return {
      providerId,
      locationNodeId: node.id,
      areaType: isSuburb ? 'SUBURB' : 'REGION',
      label: normaliseLocationDisplayName(node.label),
      provinceKey: node.provinceKey,
      cityKey: node.cityKey,
      regionKey: node.regionKey ?? derivedRegionKey,
      suburbKey: isSuburb ? (node.slug.split('__').at(-1) ?? node.slug) : null,
      active: true,
    }
  })
}
