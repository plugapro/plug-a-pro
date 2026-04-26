import { describe, expect, it } from 'vitest'
import { SERVICE_CATEGORY_OPTIONS, resolveServiceCategoryTag } from '../../lib/service-categories'
import { getCategoryPolicy } from '../../lib/service-category-policy'

describe('SERVICE_CATEGORY_OPTIONS', () => {
  it('contains exactly 15 entries (14 real categories + Other)', () => {
    expect(SERVICE_CATEGORY_OPTIONS).toHaveLength(15)
  })

  it('contains all 14 original category tags', () => {
    const tags = SERVICE_CATEGORY_OPTIONS.map((c) => c.tag)
    const expected = [
      'plumbing', 'painting', 'garden', 'handyman', 'appliances',
      'electrical', 'diy', 'roofing', 'cleaning', 'tiling',
      'pest_control', 'carpentry', 'waterproofing', 'air_conditioning',
    ]
    for (const tag of expected) {
      expect(tags).toContain(tag)
    }
  })

  it('includes "other" as the 15th entry', () => {
    const other = SERVICE_CATEGORY_OPTIONS.find((c) => c.tag === 'other')
    expect(other).toBeDefined()
    expect(other?.label).toBe('Other')
  })

  it('every entry has a non-empty tag, label, and description', () => {
    for (const cat of SERVICE_CATEGORY_OPTIONS) {
      expect(cat.tag).toBeTruthy()
      expect(cat.label).toBeTruthy()
      expect(cat.description).toBeTruthy()
    }
  })
})

describe('resolveServiceCategoryTag', () => {
  it('resolves every tag in SERVICE_CATEGORY_OPTIONS back to itself', () => {
    for (const cat of SERVICE_CATEGORY_OPTIONS) {
      expect(resolveServiceCategoryTag(cat.tag)).toBe(cat.tag)
    }
  })

  it('resolves "other" tag', () => {
    expect(resolveServiceCategoryTag('other')).toBe('other')
  })

  it('resolves label variants with spaces (Garden & Landscaping → garden)', () => {
    expect(resolveServiceCategoryTag('Garden & Landscaping')).toBe('garden')
    expect(resolveServiceCategoryTag('DIY & Assembly')).toBe('diy')
  })

  it('returns null for unknown strings', () => {
    expect(resolveServiceCategoryTag('unknown_xyz')).toBeNull()
  })
})

describe('getCategoryPolicy — tag alias resolution', () => {
  it("resolves 'garden' tag to bookingOnAssignment: true (alias for 'garden & landscaping')", () => {
    expect(getCategoryPolicy('garden').bookingOnAssignment).toBe(true)
  })

  it("resolves 'diy' tag to bookingOnAssignment: true (alias for 'diy & assembly')", () => {
    expect(getCategoryPolicy('diy').bookingOnAssignment).toBe(true)
  })

  it("resolves 'handyman' to bookingOnAssignment: true (stored as tag key)", () => {
    expect(getCategoryPolicy('handyman').bookingOnAssignment).toBe(true)
  })

  it("resolves 'cleaning' to bookingOnAssignment: true", () => {
    expect(getCategoryPolicy('cleaning').bookingOnAssignment).toBe(true)
  })

  it("resolves 'plumbing' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('plumbing').bookingOnAssignment).toBe(false)
  })

  it("resolves 'electrical' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('electrical').bookingOnAssignment).toBe(false)
  })

  it("resolves 'roofing' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('roofing').bookingOnAssignment).toBe(false)
  })

  it("resolves 'tiling' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('tiling').bookingOnAssignment).toBe(false)
  })

  it("resolves 'pest_control' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('pest_control').bookingOnAssignment).toBe(false)
  })

  it("resolves 'carpentry' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('carpentry').bookingOnAssignment).toBe(false)
  })

  it("resolves 'waterproofing' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('waterproofing').bookingOnAssignment).toBe(false)
  })

  it("resolves 'air_conditioning' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('air_conditioning').bookingOnAssignment).toBe(false)
  })

  it("resolves 'other' to bookingOnAssignment: false", () => {
    expect(getCategoryPolicy('other').bookingOnAssignment).toBe(false)
  })

  it('is case-insensitive — GARDEN resolves correctly', () => {
    expect(getCategoryPolicy('GARDEN').bookingOnAssignment).toBe(true)
  })

  it('is case-insensitive — DIY resolves correctly', () => {
    expect(getCategoryPolicy('DIY').bookingOnAssignment).toBe(true)
  })

  it('returns a safe default policy for unknown categories', () => {
    const policy = getCategoryPolicy('completely_unknown_tag')
    expect(policy.bookingOnAssignment).toBe(false)
    expect(policy.requiredCertificationCodes).toEqual([])
    expect(policy.requiredEquipmentTags).toEqual([])
    expect(policy.requiredVehicleTypes).toEqual([])
  })
})
