import { describe, it, expect } from 'vitest'
import {
  ordinal,
  isProviderDisplayEligible,
  pickMainSkill,
  buildServiceAreaLabel,
  toLabourRateText,
  normalize,
  normalizeAreaKey,
  filterDisplayableReviewAttempts,
  providerCoversRequestArea,
} from '@/lib/review-first-domain'

const activeProvider = {
  active: true,
  status: 'ACTIVE',
  name: 'John Plumber',
  availableNow: true,
  skills: ['plumbing'],
  serviceAreas: ['Soweto'],
  technicianServiceAreas: [],
}

describe('ordinal', () => {
  it('formats 1 → 1st', () => expect(ordinal(1)).toBe('1st'))
  it('formats 2 → 2nd', () => expect(ordinal(2)).toBe('2nd'))
  it('formats 3 → 3rd', () => expect(ordinal(3)).toBe('3rd'))
  it('formats 11 → 11th', () => expect(ordinal(11)).toBe('11th'))
  it('formats 21 → 21st', () => expect(ordinal(21)).toBe('21st'))
})

describe('isProviderDisplayEligible', () => {
  it('returns true for a fully valid provider', () => {
    expect(isProviderDisplayEligible(activeProvider)).toBe(true)
  })
  it('returns false when inactive', () => {
    expect(isProviderDisplayEligible({ ...activeProvider, active: false })).toBe(false)
  })
  it('returns false when status is SUSPENDED', () => {
    expect(isProviderDisplayEligible({ ...activeProvider, status: 'SUSPENDED' })).toBe(false)
  })
  it('returns false when not available now', () => {
    expect(isProviderDisplayEligible({ ...activeProvider, availableNow: false })).toBe(false)
  })
  it('returns false when name is blank', () => {
    expect(isProviderDisplayEligible({ ...activeProvider, name: '   ' })).toBe(false)
  })
  it('returns false with no skills', () => {
    expect(isProviderDisplayEligible({ ...activeProvider, skills: [] })).toBe(false)
  })
  it('returns true when serviceAreas is empty but technicianServiceAreas has an active entry', () => {
    expect(
      isProviderDisplayEligible({
        ...activeProvider,
        serviceAreas: [],
        technicianServiceAreas: [{ active: true, label: 'Joburg North', city: 'Johannesburg' }],
      }),
    ).toBe(true)
  })
})

describe('pickMainSkill', () => {
  it('returns the matching skill when category matches', () => {
    expect(pickMainSkill(['plumbing', 'electrical'], 'plumbing')).toBe('plumbing')
  })
  it('falls back to first skill when no match', () => {
    expect(pickMainSkill(['electrical', 'hvac'], 'painting')).toBe('electrical')
  })
  it('falls back to requestCategory when skills is empty', () => {
    expect(pickMainSkill([], 'plumbing')).toBe('plumbing')
  })
})

describe('buildServiceAreaLabel', () => {
  it('prefers structured technicianServiceAreas label', () => {
    expect(
      buildServiceAreaLabel({
        serviceAreas: ['Soweto'],
        technicianServiceAreas: [{ active: true, label: 'Joburg North', city: 'Johannesburg' }],
      }),
    ).toBe('Joburg North')
  })
  it('falls back to serviceAreas string', () => {
    expect(
      buildServiceAreaLabel({
        serviceAreas: ['Midrand'],
        technicianServiceAreas: [],
      }),
    ).toBe('Midrand')
  })
  it('returns null when no areas exist', () => {
    expect(buildServiceAreaLabel({ serviceAreas: [], technicianServiceAreas: [] })).toBeNull()
  })
})

describe('toLabourRateText', () => {
  it('prefers hourly rate', () => expect(toLabourRateText(null, 300, false)).toBe('from R300/hr'))
  it('uses call-out fee when no hourly', () => expect(toLabourRateText(150, null, false)).toBe('call-out from R150'))
  it('shows negotiable when no rates', () => expect(toLabourRateText(null, null, true)).toBe('rate negotiable'))
  it('returns null when nothing set', () => expect(toLabourRateText(null, null, false)).toBeNull())
})

describe('normalize', () => {
  it('trims and lowercases', () => expect(normalize('  Plumbing  ')).toBe('plumbing'))
  it('handles null', () => expect(normalize(null)).toBe(''))
  it('handles undefined', () => expect(normalize(undefined)).toBe(''))
})

describe('normalizeAreaKey', () => {
  it('replaces spaces with underscores', () => {
    expect(normalizeAreaKey('East Rand')).toBe('east_rand')
  })
  it('lowercases and trims', () => {
    // normalize() trims outer whitespace; \s+ then collapses inner runs to single _
    expect(normalizeAreaKey('  North  West  ')).toBe('north_west')
  })
})

// ---------------------------------------------------------------------------
// Shared typed fixtures for filterDisplayableReviewAttempts and
// providerCoversRequestArea — defined here so both describe blocks can reuse
// them without `as any`.
// ---------------------------------------------------------------------------

type StructuredArea = {
  active: boolean
  label: string | null
  city: string | null
  regionKey: string | null
  suburbKey: string | null
  locationNodeId: string | null
}

type ReviewAddress = {
  suburb: string
  city: string
  region: string | null
  locationNodeId: string | null
  locationNode: { regionKey: string | null } | null
}

type ReviewProviderFixture = {
  active: boolean
  status: string
  name: string
  availableNow: boolean
  skills: string[]
  serviceAreas: string[]
  technicianServiceAreas: StructuredArea[]
}

type ReviewAttemptFixture = {
  providerId: string
  provider: ReviewProviderFixture
}

type ReviewRequestFixture = {
  category: string
  leads: Array<{ providerId: string; status: string }>
  address: ReviewAddress
}

const filterBaseRequest: ReviewRequestFixture = {
  category: 'plumbing',
  leads: [],
  address: {
    suburb: 'johannesburg',
    city: 'johannesburg',
    region: null,
    locationNodeId: null,
    locationNode: null,
  },
}

const filterBaseAttempt: ReviewAttemptFixture = {
  providerId: 'prov-1',
  provider: {
    active: true,
    status: 'ACTIVE',
    name: 'John Plumber',
    availableNow: true,
    skills: ['plumbing'],
    serviceAreas: [],
    technicianServiceAreas: [
      {
        active: true,
        label: 'Joburg Central',
        city: 'johannesburg',
        regionKey: null,
        suburbKey: null,
        locationNodeId: null,
      },
    ],
  },
}

describe('filterDisplayableReviewAttempts', () => {
  it('includes a matching provider', () => {
    const result = filterDisplayableReviewAttempts([filterBaseAttempt], filterBaseRequest)
    expect(result).toHaveLength(1)
  })
  it('excludes a provider already in leads with status SHORTLISTED', () => {
    const request = { ...filterBaseRequest, leads: [{ providerId: 'prov-1', status: 'SHORTLISTED' }] }
    const result = filterDisplayableReviewAttempts([filterBaseAttempt], request)
    expect(result).toHaveLength(0)
  })
  it('excludes a provider not eligible (inactive)', () => {
    const attempt: ReviewAttemptFixture = { ...filterBaseAttempt, provider: { ...filterBaseAttempt.provider, active: false } }
    const result = filterDisplayableReviewAttempts([attempt], filterBaseRequest)
    expect(result).toHaveLength(0)
  })
  it('excludes when skill does not match category', () => {
    const attempt: ReviewAttemptFixture = { ...filterBaseAttempt, provider: { ...filterBaseAttempt.provider, skills: ['electrical'] } }
    const result = filterDisplayableReviewAttempts([attempt], filterBaseRequest)
    expect(result).toHaveLength(0)
  })
})

describe('providerCoversRequestArea', () => {
  const noAreas: ReviewProviderFixture = {
    active: true,
    status: 'ACTIVE',
    name: 'Jane',
    availableNow: true,
    skills: ['plumbing'],
    serviceAreas: [],
    technicianServiceAreas: [],
  }

  const joburg: ReviewAddress = {
    suburb: 'braamfontein',
    city: 'johannesburg',
    region: 'gauteng',
    locationNodeId: 'node-jhb',
    locationNode: { regionKey: 'gauteng' },
  }

  // -------------------------------------------------------------------------
  // Structured area — city match
  // -------------------------------------------------------------------------
  it('returns true when technicianServiceAreas city matches request city', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: null, city: 'johannesburg', regionKey: null, suburbKey: null, locationNodeId: null },
      ],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  it('returns true when technicianServiceAreas label matches request city', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: 'johannesburg', city: null, regionKey: null, suburbKey: null, locationNodeId: null },
      ],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Structured area — suburbKey match
  // -------------------------------------------------------------------------
  it('returns true when technicianServiceAreas suburbKey matches request suburb', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: null, city: null, regionKey: null, suburbKey: 'braamfontein', locationNodeId: null },
      ],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  it('normalises suburbKey with underscores (East_Rand vs east rand)', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: null, city: null, regionKey: null, suburbKey: 'East_Rand', locationNodeId: null },
      ],
    }
    const address: ReviewAddress = { suburb: 'East Rand', city: 'ekurhuleni', region: null, locationNodeId: null, locationNode: null }
    expect(providerCoversRequestArea(provider, { address })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Structured area — locationNodeId match
  // -------------------------------------------------------------------------
  it('returns true when technicianServiceAreas locationNodeId matches request locationNodeId', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: null, city: null, regionKey: null, suburbKey: null, locationNodeId: 'node-jhb' },
      ],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Structured area — regionKey match
  // -------------------------------------------------------------------------
  it('returns true when technicianServiceAreas regionKey matches request region', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: null, city: null, regionKey: 'gauteng', suburbKey: null, locationNodeId: null },
      ],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  it('returns true when regionKey matches via locationNode.regionKey fallback', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: true, label: null, city: null, regionKey: 'gauteng', suburbKey: null, locationNodeId: null },
      ],
    }
    const address: ReviewAddress = {
      suburb: 'midrand',
      city: 'johannesburg',
      region: null, // region field is null; regionKey comes from locationNode
      locationNodeId: null,
      locationNode: { regionKey: 'gauteng' },
    }
    expect(providerCoversRequestArea(provider, { address })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Legacy serviceAreas string fallback
  // -------------------------------------------------------------------------
  it('returns true via legacy serviceAreas suburb match', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      serviceAreas: ['braamfontein'],
      technicianServiceAreas: [],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  it('returns true via legacy serviceAreas city match', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      serviceAreas: ['johannesburg'],
      technicianServiceAreas: [],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  it('returns true via legacy serviceAreas region match', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      serviceAreas: ['gauteng'],
      technicianServiceAreas: [],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Returns false
  // -------------------------------------------------------------------------
  it('returns false when no area matches and legacy serviceAreas is empty', () => {
    expect(providerCoversRequestArea(noAreas, { address: joburg })).toBe(false)
  })

  it('returns false when all structured areas are inactive', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      technicianServiceAreas: [
        { active: false, label: null, city: 'johannesburg', regionKey: null, suburbKey: null, locationNodeId: null },
      ],
    }
    expect(providerCoversRequestArea(provider, { address: joburg })).toBe(false)
  })

  it('returns false when address is null', () => {
    const provider: ReviewProviderFixture = {
      ...noAreas,
      serviceAreas: ['johannesburg'],
      technicianServiceAreas: [],
    }
    expect(providerCoversRequestArea(provider, { address: null })).toBe(false)
  })
})
