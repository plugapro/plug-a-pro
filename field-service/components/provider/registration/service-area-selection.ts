// Pure selection logic for the provider registration "area" step.
//
// The step works on one region at a time (selectRegion resets the selection),
// so a selection is either N suburb ids or exactly one REGION id ("my suburb
// isn't listed — cover the whole region"). serviceAreas[] (labels) and
// locationNodeIds[] are index-aligned; every helper keeps them that way.

export type ServiceAreaSelection = {
  serviceAreas: string[]
  locationNodeIds: string[]
}

export type AreaNode = { id: string; label: string }

const EMPTY: ServiceAreaSelection = { serviceAreas: [], locationNodeIds: [] }

export function isWholeRegionSelected(selection: ServiceAreaSelection, regionId: string): boolean {
  return regionId !== '' && selection.locationNodeIds.includes(regionId)
}

export function hasAnyServiceArea(selection: ServiceAreaSelection): boolean {
  return selection.locationNodeIds.length > 0
}

export function removeServiceArea(selection: ServiceAreaSelection, nodeId: string): ServiceAreaSelection {
  const index = selection.locationNodeIds.indexOf(nodeId)
  if (index < 0) return selection
  return {
    serviceAreas: selection.serviceAreas.filter((_, i) => i !== index),
    locationNodeIds: selection.locationNodeIds.filter((_, i) => i !== index),
  }
}

/** Toggle whole-region coverage. On: the region replaces every suburb. Off: empty. */
export function applyWholeRegion(selection: ServiceAreaSelection, region: AreaNode): ServiceAreaSelection {
  if (isWholeRegionSelected(selection, region.id)) return EMPTY
  return { serviceAreas: [region.label], locationNodeIds: [region.id] }
}

/** Toggle one suburb. Adding a suburb switches whole-region coverage off. */
export function applySuburbToggle(
  selection: ServiceAreaSelection,
  suburb: AreaNode,
  regionId: string,
): ServiceAreaSelection {
  if (selection.locationNodeIds.includes(suburb.id)) return removeServiceArea(selection, suburb.id)
  const base = isWholeRegionSelected(selection, regionId) ? removeServiceArea(selection, regionId) : selection
  return {
    serviceAreas: [...base.serviceAreas, suburb.label],
    locationNodeIds: [...base.locationNodeIds, suburb.id],
  }
}
