import { describe, expect, it } from 'vitest'
import {
  applicationBlocksAutoApproval,
  buildManualReviewSummary,
  isApprovalUndoBlocked,
  isHighRiskCategory,
  requiresManualReview,
} from '@/lib/provider-application-review-guards'

// ─── isHighRiskCategory ───────────────────────────────────────────────────────

describe('isHighRiskCategory', () => {
  it.each(['electrical', 'pest_control', 'air_conditioning', 'roofing', 'plumbing'])(
    'returns true for high-risk / regulated category: %s',
    (category) => {
      expect(isHighRiskCategory(category)).toBe(true)
    },
  )

  it.each(['painting', 'handyman', 'cleaning', 'tiling', 'carpentry'])(
    'returns false for standard category: %s',
    (category) => {
      expect(isHighRiskCategory(category)).toBe(false)
    },
  )

  it('default-blocks an unknown / unrecognised category', () => {
    expect(isHighRiskCategory('widget_polishing')).toBe(true)
  })

  it('is case-insensitive for known categories', () => {
    // getServiceComplianceRequirement normalises via normalizeComplianceKey
    expect(isHighRiskCategory('Electrical')).toBe(true)
    expect(isHighRiskCategory('ROOFING')).toBe(true)
  })
})

// ─── requiresManualReview ─────────────────────────────────────────────────────

describe('requiresManualReview', () => {
  const baseApp = {
    id: 'app-1',
    skills: [] as string[],
    status: 'PENDING',
    providerId: null,
  }

  it('does not require review when skills list is empty', () => {
    const result = requiresManualReview({ ...baseApp, skills: [] })
    expect(result.required).toBe(false)
    expect(result.requirements).toHaveLength(0)
    expect(result.reasonCodes).toHaveLength(0)
  })

  it('does not require review for an all-standard-category application', () => {
    const result = requiresManualReview({
      ...baseApp,
      skills: ['Painting', 'Handyman', 'Cleaning'],
    })
    expect(result.required).toBe(false)
    expect(result.requirements).toHaveLength(0)
    expect(result.reasonCodes).not.toContain('HIGH_RISK_CATEGORY')
  })

  it('requires review when any skill is a high-risk category', () => {
    const result = requiresManualReview({
      ...baseApp,
      skills: ['Plumbing', 'Electrical'],
    })
    expect(result.required).toBe(true)
    expect(result.reasonCodes).toContain('HIGH_RISK_CATEGORY')
    expect(result.requirements).toHaveLength(2)
    expect(result.requirements.map((requirement) => requirement.categorySlug)).toEqual([
      'plumbing',
      'electrical',
    ])
  })

  it('deduplicates requirements when the same high-risk skill appears twice', () => {
    const result = requiresManualReview({
      ...baseApp,
      skills: ['Electrical', 'Electrical', 'Painting'],
    })
    expect(result.required).toBe(true)
    expect(result.requirements).toHaveLength(1)
  })

  it('captures all distinct high-risk categories from a multi-skill application', () => {
    const result = requiresManualReview({
      ...baseApp,
      skills: ['Electrical', 'Roofing', 'Painting'],
    })
    expect(result.required).toBe(true)
    expect(result.requirements).toHaveLength(2)
    const slugs = result.requirements.map((r) => r.categorySlug)
    expect(slugs).toContain('electrical')
    expect(slugs).toContain('roofing')
  })

  it('includes evidencePrompt on each requirement', () => {
    const result = requiresManualReview({
      ...baseApp,
      skills: ['pest_control'],
    })
    expect(result.required).toBe(true)
    expect(result.requirements[0].evidencePrompt).toBeTruthy()
  })

  it('marks certificationRequiredForApproval correctly for regulated categories', () => {
    const result = requiresManualReview({
      ...baseApp,
      skills: ['electrical'],
    })
    expect(result.requirements[0].certificationRequiredForApproval).toBe(true)
  })
})

// ─── applicationBlocksAutoApproval ───────────────────────────────────────────

describe('applicationBlocksAutoApproval', () => {
  it('returns false for an application with only standard categories', () => {
    expect(applicationBlocksAutoApproval({ skills: ['Painting', 'Handyman'] })).toBe(false)
  })

  it('returns true for an application with at least one high-risk category', () => {
    expect(applicationBlocksAutoApproval({ skills: ['Handyman', 'Electrical'] })).toBe(true)
  })

  it('returns false for an empty skills list', () => {
    expect(applicationBlocksAutoApproval({ skills: [] })).toBe(false)
  })
})

// ─── isApprovalUndoBlocked ────────────────────────────────────────────────────

describe('isApprovalUndoBlocked', () => {
  it('returns true when the application is already APPROVED', () => {
    expect(
      isApprovalUndoBlocked({ id: 'app-1', skills: [], status: 'APPROVED' }),
    ).toBe(true)
  })

  it('returns false for PENDING status', () => {
    expect(
      isApprovalUndoBlocked({ id: 'app-1', skills: [], status: 'PENDING' }),
    ).toBe(false)
  })

  it('returns false for MORE_INFO_REQUIRED status', () => {
    expect(
      isApprovalUndoBlocked({ id: 'app-1', skills: [], status: 'MORE_INFO_REQUIRED' }),
    ).toBe(false)
  })

  it('returns false for REJECTED status', () => {
    expect(
      isApprovalUndoBlocked({ id: 'app-1', skills: [], status: 'REJECTED' }),
    ).toBe(false)
  })
})

// ─── buildManualReviewSummary ─────────────────────────────────────────────────

describe('buildManualReviewSummary', () => {
  it('returns null for a standard application', () => {
    const result = buildManualReviewSummary({
      id: 'app-1',
      skills: ['Painting', 'Handyman'],
      status: 'PENDING',
    })
    expect(result).toBeNull()
  })

  it('returns a non-empty human-readable string for a high-risk application', () => {
    const result = buildManualReviewSummary({
      id: 'app-2',
      skills: ['Electrical'],
      status: 'PENDING',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('Electrical')
    expect(result!.length).toBeGreaterThan(10)
  })

  it('lists multiple high-risk categories in the summary', () => {
    const result = buildManualReviewSummary({
      id: 'app-3',
      skills: ['Roofing', 'Pest Control'],
      status: 'PENDING',
    })
    expect(result).toContain('Roofing')
    expect(result).toContain('Pest Control')
  })
})
