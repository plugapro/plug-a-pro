import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import ProvidersPage from '@/app/(customer)/providers/page'
import ProviderProfilePage from '@/app/(customer)/providers/[id]/page'

const {
  mockGetSession,
  mockIsEnabled,
  mockProviderFindMany,
  mockProviderFindUnique,
  mockJobFindMany,
  mockReviewFindMany,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockProviderFindMany: vi.fn(),
  mockProviderFindUnique: vi.fn(),
  mockJobFindMany: vi.fn(),
  mockReviewFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findMany: mockProviderFindMany,
      findUnique: mockProviderFindUnique,
    },
    job: {
      findMany: mockJobFindMany,
    },
    review: {
      findMany: mockReviewFindMany,
    },
  },
}))

describe('anonymous provider discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockIsEnabled.mockResolvedValue(true)
    mockProviderFindMany.mockResolvedValue([])
    mockProviderFindUnique.mockResolvedValue(null)
    mockJobFindMany.mockResolvedValue([])
    mockReviewFindMany.mockResolvedValue([])
  })

  it('serves the providers catalogue anonymously when the feature flag is enabled', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        id: 'provider-1',
        name: 'Ana K',
        bio: 'Reliable installer for domestic systems.',
        experience: '8 years',
        skills: ['plumbing', 'electrical'],
        serviceAreas: ['Johannesburg'],
        averageRating: 4.9,
        completedJobsCount: 64,
        verified: true,
        avatarUrl: null,
        availableNow: true,
        reliabilityScore: 0.85,
        strikes: 0,
        providerCategories: [
          {
            categorySlug: 'plumbing',
            subServices: ['Leak repair'],
            yearsExperience: 8,
            approvalStatus: 'APPROVED',
          },
        ],
        providerRates: [
          {
            categorySlug: 'plumbing',
            callOutFee: { toNumber: () => 450 },
            hourlyRate: { toNumber: () => 350 },
            rateNegotiable: true,
          },
        ],
        technicianAvailability: { availabilityState: 'AVAILABLE' },
      },
    ])

    const html = renderToStaticMarkup(await ProvidersPage({ searchParams: Promise.resolve({}) }))

    expect(mockProviderFindMany).toHaveBeenCalledTimes(1)
    expect(mockProviderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        verified: true,
        status: 'ACTIVE',
      }),
    }))
    expect(html).toContain('Find a provider')
    expect(html).toContain('Ana K')
  })

  it('renders a sign-in CTA on a provider profile when session is null', async () => {
    mockProviderFindUnique.mockResolvedValue({
      id: 'provider-1',
      name: 'Ana K',
      avatarUrl: null,
      bio: 'Reliable installer for domestic systems.',
      experience: '8 years',
      skills: ['plumbing'],
      serviceAreas: ['Johannesburg'],
      evidenceNote: null,
      portfolioUrls: [],
      verified: true,
      providerCategories: [],
      providerRates: [],
    })
    mockJobFindMany.mockResolvedValue([])
    mockReviewFindMany.mockResolvedValue([])

    const html = renderToStaticMarkup(await ProviderProfilePage({ params: Promise.resolve({ id: 'provider-1' }) }))

    expect(html).toContain('Sign in to request service')
    expect(html).toContain('/sign-in?next=%2Fbook%2Fplumbing%3Fprovider%3Dprovider-1')
  })

  it('renders a booking CTA on a provider profile when session.role is customer', async () => {
    mockGetSession.mockResolvedValue({ id: 'customer-1', role: 'customer' })
    mockProviderFindUnique.mockResolvedValue({
      id: 'provider-1',
      name: 'Ana K',
      avatarUrl: null,
      bio: 'Reliable installer for domestic systems.',
      experience: '8 years',
      skills: ['plumbing'],
      serviceAreas: ['Johannesburg'],
      evidenceNote: null,
      portfolioUrls: [],
      verified: true,
      providerCategories: [],
      providerRates: [],
    })
    mockJobFindMany.mockResolvedValue([])
    mockReviewFindMany.mockResolvedValue([])

    const html = renderToStaticMarkup(await ProviderProfilePage({ params: Promise.resolve({ id: 'provider-1' }) }))

    expect(html).toContain('Request service from this provider')
    expect(html).toContain('/book/plumbing?provider=provider-1')
    expect(html).not.toContain('Sign in to request service')
  })
})
