// Regression: the customer home greeting is gated on a server-validated session,
// not on cached client state. After sign-out clears the HttpOnly cookie,
// getSession() returns null and the home must render neutral copy - never
// "Hi <provider>". This locks the product behaviour from the Lovemore bug:
// a stale identity can only ever surface if a real session still resolves.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetSession, mockResolveCustomer, mockProviderFindFirst, mockJobCount, mockProviderCount, mockIsEnabled } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockResolveCustomer: vi.fn(),
    mockProviderFindFirst: vi.fn(),
    mockJobCount: vi.fn(),
    mockProviderCount: vi.fn(),
    mockIsEnabled: vi.fn(),
  }))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({
  db: {
    provider: { findFirst: mockProviderFindFirst, count: mockProviderCount },
    job: { count: mockJobCount },
  },
}))
vi.mock('@/lib/customer-session', () => ({ resolveCustomerForSession: mockResolveCustomer }))
vi.mock('@/lib/metadata', () => ({ buildMetadata: () => ({}) }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/customer-serviceability', () => ({
  resolveAreaScope: vi.fn().mockResolvedValue(null),
  listServiceableCategoriesForArea: vi.fn().mockResolvedValue([]),
  countActiveProvidersFor: vi.fn().mockResolvedValue(0),
}))
vi.mock('@/lib/service-categories', () => ({ getServiceCategoryLabel: (t: string) => t }))
vi.mock('@/lib/location-format', () => ({ formatLocationSlugLabel: (s: string) => s }))

// Presentational/client children are irrelevant to the greeting assertion.
vi.mock('@/components/shared/app-logo', () => ({ AppLogo: () => null }))
vi.mock('@/components/shared/wordmark', () => ({ Wordmark: () => null }))
vi.mock('@/components/ui/section-label', () => ({ SectionLabel: () => null }))
vi.mock('@/components/customer/AreaSelector', () => ({ AreaSelector: () => null }))
vi.mock('@/components/customer/CustomerRequestSearchForm', () => ({ CustomerRequestSearchForm: () => null }))
vi.mock('@/components/customer/HomeServiceSearch', () => ({ HomeServiceSearch: () => null }))
vi.mock('@/components/customer/ComingSoonTile', () => ({ ComingSoonTile: () => null }))

describe('customer home greeting auth gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveCustomer.mockResolvedValue(null)
    mockProviderFindFirst.mockResolvedValue(null)
    mockJobCount.mockResolvedValue(0)
    mockProviderCount.mockResolvedValue(0)
    mockIsEnabled.mockResolvedValue(false)
  })

  it('shows neutral copy and no name when there is no session (post sign-out)', async () => {
    mockGetSession.mockResolvedValue(null)
    const Page = (await import('@/app/(customer)/page')).default

    const html = renderToStaticMarkup(await Page({}))

    expect(html).toContain('Skilled help near you')
    expect(html).not.toContain('Hi ')
    expect(html).not.toContain('what needs fixing?')
    expect(html).not.toContain('Lovemore')
  })

  it('greets a provider only while their session still resolves server-side', async () => {
    mockGetSession.mockResolvedValue({ id: 'u1', role: 'provider', phone: '+27693552447', providerId: 'prov-1' })
    mockProviderFindFirst.mockResolvedValue({ id: 'prov-1', name: 'Lovemore' })
    const Page = (await import('@/app/(customer)/page')).default

    const html = renderToStaticMarkup(await Page({}))

    expect(html).toContain('Hi Lovemore')
    expect(html).toContain('what needs fixing?')
  })
})
