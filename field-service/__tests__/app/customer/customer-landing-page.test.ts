import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomerHomePage from '@/app/(customer)/page'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockProviderFindFirst,
  mockProviderFindMany,
  mockProviderCount,
  mockJobRequestCount,
  mockJobCount,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockProviderFindMany: vi.fn(),
  mockProviderCount: vi.fn(),
  mockJobRequestCount: vi.fn(),
  mockJobCount: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/components/customer/AreaSelector', () => ({
  AreaSelector: () => null,
}))

vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findFirst: mockProviderFindFirst,
      findMany: mockProviderFindMany,
      count: mockProviderCount,
    },
    jobRequest: {
      count: mockJobRequestCount,
    },
    job: {
      count: mockJobCount,
    },
  },
}))

describe('customer mobile landing page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockResolveCustomerForSession.mockResolvedValue(null)
    mockProviderFindFirst.mockResolvedValue(null)
    mockProviderFindMany.mockResolvedValue([])
    mockProviderCount.mockResolvedValue(0)
    mockJobRequestCount.mockResolvedValue(0)
    mockJobCount.mockResolvedValue(0)
  })

  it('renders clear customer and provider CTAs', async () => {
    const html = renderToStaticMarkup(await CustomerHomePage())

    expect(html).toContain('Skilled help near you.')
    expect(html).toContain('Request')
    expect(html).toContain('Join as provider')
  })

  it('renders required category shortcuts', async () => {
    const html = renderToStaticMarkup(await CustomerHomePage())

    expect(html).toContain('Plumbing')
    expect(html).toContain('Handyman')
    expect(html).toContain('Appliances')
    expect(html).toContain('Carpentry')
    expect(html).toContain('Cleaning')
    expect(html).toContain('Painting')
    expect(html).toContain('Tiling')
    expect(html).toContain('Plastering')
    expect(html).toContain('Rhinoliting')
  })

  it('renders provider-home actions when a provider is signed in', async () => {
    mockGetSession.mockResolvedValue({ id: 'u-1', role: 'provider', phone: '+27820000000' })
    mockProviderFindFirst.mockResolvedValue({ id: 'p-1', name: 'Lovemore Sibanda' })
    mockJobCount.mockResolvedValue(2)

    const html = renderToStaticMarkup(await CustomerHomePage())

    expect(html).toContain('Hi Lovemore')
    expect(html).toContain('what needs fixing?')
    expect(html).not.toContain('Join as provider')
  })

  it('renders multi-role context switch when customer and provider are both present', async () => {
    mockGetSession.mockResolvedValue({ id: 'u-2', role: 'provider', phone: '+27821111111' })
    mockProviderFindFirst.mockResolvedValue({ id: 'p-2', name: 'Sarah M' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'c-2', name: 'Sarah M' })

    const html = renderToStaticMarkup(await CustomerHomePage())

    expect(html).toContain('Hi Sarah')
    expect(html).toContain('what needs fixing?')
    expect(html).toContain('Join as provider')
  })
})
