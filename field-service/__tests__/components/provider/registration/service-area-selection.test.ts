import { describe, expect, it } from 'vitest'
import {
  applySuburbToggle,
  applyWholeRegion,
  hasAnyServiceArea,
  isWholeRegionSelected,
  removeServiceArea,
  type ServiceAreaSelection,
} from '@/components/provider/registration/service-area-selection'

const REGION = { id: 'region-ct-cbd', label: 'Cape Town CBD & Atlantic Seaboard' }
const SEA_POINT = { id: 'sub-sea-point', label: 'Sea Point' }
const GARDENS = { id: 'sub-gardens', label: 'Gardens' }
const EMPTY: ServiceAreaSelection = { serviceAreas: [], locationNodeIds: [] }

describe('service-area-selection (registration area step)', () => {
  it('whole region replaces any selected suburbs with the single region id and label', () => {
    const withSuburbs = applySuburbToggle(EMPTY, SEA_POINT, REGION.id)
    const result = applyWholeRegion(withSuburbs, REGION)
    expect(result).toEqual({ serviceAreas: [REGION.label], locationNodeIds: [REGION.id] })
    expect(isWholeRegionSelected(result, REGION.id)).toBe(true)
  })

  it('selecting whole region again toggles it off', () => {
    const on = applyWholeRegion(EMPTY, REGION)
    expect(applyWholeRegion(on, REGION)).toEqual(EMPTY)
  })

  it('picking a suburb clears the whole-region option for that region', () => {
    const wholeRegion = applyWholeRegion(EMPTY, REGION)
    const result = applySuburbToggle(wholeRegion, GARDENS, REGION.id)
    expect(result).toEqual({ serviceAreas: ['Gardens'], locationNodeIds: ['sub-gardens'] })
    expect(isWholeRegionSelected(result, REGION.id)).toBe(false)
  })

  it('suburb toggle adds then removes, keeping labels and ids index-aligned', () => {
    const one = applySuburbToggle(EMPTY, SEA_POINT, REGION.id)
    const two = applySuburbToggle(one, GARDENS, REGION.id)
    expect(two).toEqual({
      serviceAreas: ['Sea Point', 'Gardens'],
      locationNodeIds: ['sub-sea-point', 'sub-gardens'],
    })
    expect(applySuburbToggle(two, SEA_POINT, REGION.id)).toEqual({
      serviceAreas: ['Gardens'],
      locationNodeIds: ['sub-gardens'],
    })
  })

  it('removeServiceArea drops the matching pair and ignores unknown ids', () => {
    const two = applySuburbToggle(applySuburbToggle(EMPTY, SEA_POINT, REGION.id), GARDENS, REGION.id)
    expect(removeServiceArea(two, 'sub-gardens')).toEqual({
      serviceAreas: ['Sea Point'],
      locationNodeIds: ['sub-sea-point'],
    })
    expect(removeServiceArea(two, 'nope')).toBe(two)
  })

  it('hasAnyServiceArea is satisfied by a region id as much as by a suburb id', () => {
    expect(hasAnyServiceArea(EMPTY)).toBe(false)
    expect(hasAnyServiceArea(applyWholeRegion(EMPTY, REGION))).toBe(true)
    expect(hasAnyServiceArea(applySuburbToggle(EMPTY, SEA_POINT, REGION.id))).toBe(true)
  })

  it('isWholeRegionSelected is false for an empty region id', () => {
    expect(isWholeRegionSelected(applyWholeRegion(EMPTY, REGION), '')).toBe(false)
  })

  it('recognises a re-hydrated draft selection holding the region id', () => {
    const draft: ServiceAreaSelection = { serviceAreas: [REGION.label], locationNodeIds: [REGION.id] }
    expect(isWholeRegionSelected(draft, REGION.id)).toBe(true)
    expect(removeServiceArea(draft, REGION.id)).toEqual(EMPTY)
  })

  it('empty results do not share array identity', () => {
    const on = applyWholeRegion(EMPTY, REGION)
    const a = applyWholeRegion(on, REGION)
    const b = applyWholeRegion(on, REGION)
    expect(a.serviceAreas).not.toBe(b.serviceAreas)
    expect(a.locationNodeIds).not.toBe(b.locationNodeIds)
  })
})
