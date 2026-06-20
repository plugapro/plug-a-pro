// Defense-in-depth: the /book/[serviceId] preferred-provider validation
// block must filter on kycStatus explicitly so a non-VERIFIED provider id in
// the URL (?provider=) gets dropped before being handed to BookingFlow. The
// legacy verified=true / status=ACTIVE chain is preserved unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockResolveReusableCustomerSites,
  mockJobRequestFindFirst,
  mockProviderFindFirst,
  mockLocationNodeFindFirst,
  mockBookingFlow,
  mockRedirect,
  mockNotFound,
  mockIsEnabled,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockResolveReusableCustomerSites: vi.fn(),
  mockJobRequestFindFirst: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockLocationNodeFindFirst: vi.fn(),
  mockBookingFlow: vi.fn((props: { category: { slug: string } }) => (
    <main>Booking flow for {props.category.slug}</main>
  )),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('not-found')
  }),
  mockIsEnabled: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))
vi.mock('@/lib/customer-address-book', () => ({
  resolveReusableCustomerSites: mockResolveReusableCustomerSites,
}))
vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: { findFirst: mockJobRequestFindFirst },
    provider: { findFirst: mockProviderFindFirst },
    locationNode: { findFirst: mockLocationNodeFindFirst },
  },
}))
vi.mock('@/components/customer/BookingFlow', () => ({
  BookingFlow: mockBookingFlow,
}))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

describe('/book/[serviceId] — preferred-provider KYC defense-in-depth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockResolveCustomerForSession.mockResolvedValue(null)
    mockResolveReusableCustomerSites.mockResolvedValue([])
    mockJobRequestFindFirst.mockResolvedValue(null)
    mockProviderFindFirst.mockResolvedValue({ id: 'provider-9' })
    mockLocationNodeFindFirst.mockResolvedValue(null)
    mockIsEnabled.mockResolvedValue(false)
  })

  it('adds an explicit kycStatus=VERIFIED filter when the grace flag is OFF', async () => {
    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'plumbing' }),
        searchParams: Promise.resolve({ provider: 'provider-9' }),
      }),
    )

    expect(mockProviderFindFirst).toHaveBeenCalledTimes(1)
    const args = mockProviderFindFirst.mock.calls[0]?.[0]
    expect(args.where).toMatchObject({
      id: 'provider-9',
      active: true,
      verified: true,
      status: 'ACTIVE',
    })
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kycStatus: 'VERIFIED' }),
      ]),
    )
  })

  it('switches to the grace OR when matching.kyc_grace_legacy_providers is ON', async () => {
    mockIsEnabled.mockImplementation(async (flag: string) =>
      flag === 'matching.kyc_grace_legacy_providers',
    )

    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'plumbing' }),
        searchParams: Promise.resolve({ provider: 'provider-9' }),
      }),
    )

    const args = mockProviderFindFirst.mock.calls[0]?.[0]
    expect(args.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            { kycStatus: 'VERIFIED' },
            expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({ createdAt: { lt: expect.any(Date) } }),
                expect.objectContaining({
                  kycStatus: { notIn: expect.arrayContaining(['REJECTED', 'EXPIRED']) },
                }),
              ]),
            }),
          ]),
        }),
      ]),
    )
  })
})
