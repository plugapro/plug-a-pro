import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockResolveReusableCustomerSites,
  mockJobRequestFindFirst,
  mockProviderFindFirst,
  mockBookingFlow,
  mockRedirect,
  mockNotFound,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockResolveReusableCustomerSites: vi.fn(),
  mockJobRequestFindFirst: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockBookingFlow: vi.fn((props: any) => (
    <main>
      Booking flow for {props.category.slug}
      <span data-address-book={String(props.addressBookEnabled)} />
      <span data-saved-sites={String(props.savedSites.length)} />
    </main>
  )),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('not-found')
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))

vi.mock('@/lib/customer-address-book', () => ({
  resolveReusableCustomerSites: mockResolveReusableCustomerSites,
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: {
      findFirst: mockJobRequestFindFirst,
    },
    provider: {
      findFirst: mockProviderFindFirst,
    },
  },
}))

vi.mock('@/components/customer/BookingFlow', () => ({
  BookingFlow: mockBookingFlow,
}))

describe('customer booking entry auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockResolveCustomerForSession.mockResolvedValue(null)
    mockResolveReusableCustomerSites.mockResolvedValue([])
    mockJobRequestFindFirst.mockResolvedValue(null)
    mockProviderFindFirst.mockResolvedValue(null)
  })

  it('lets logged-out visitors reach /book routes through proxy', async () => {
    const { proxy } = await import('@/proxy')

    const response = await proxy(new NextRequest('http://localhost/book/plumbing'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('renders the booking flow for anonymous visitors instead of redirecting to sign-in', async () => {
    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'plumbing' }),
        searchParams: Promise.resolve({}),
      }),
    )

    expect(html).toContain('Booking flow for plumbing')
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockResolveCustomerForSession).not.toHaveBeenCalled()
    expect(mockBookingFlow).toHaveBeenCalledWith(expect.objectContaining({
      addressBookEnabled: false,
      savedSites: [],
      initialDraft: undefined,
    }), undefined)
  })

  it('still loads saved sites and template drafts for signed-in customers', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'customer', phone: '+27821234567' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1', name: 'Sarah' })
    mockResolveReusableCustomerSites.mockResolvedValue([{ id: 'site-1' }])
    mockJobRequestFindFirst.mockResolvedValue({
      title: 'Old leaking tap',
      description: 'Kitchen sink leak',
    })

    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'plumbing' }),
        searchParams: Promise.resolve({ template: 'jr-1' }),
      }),
    )

    expect(mockResolveCustomerForSession).toHaveBeenCalled()
    expect(mockResolveReusableCustomerSites).toHaveBeenCalledWith({
      customerId: 'cust-1',
      authUserId: 'user-1',
      customerPhone: '+27821234567',
      source: 'pwa',
    })
    expect(mockJobRequestFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'jr-1', customerId: 'cust-1' },
    }))
    expect(mockBookingFlow).toHaveBeenCalledWith(expect.objectContaining({
      addressBookEnabled: true,
      savedSites: [{ id: 'site-1' }],
      initialDraft: {
        title: 'Old leaking tap',
        description: 'Kitchen sink leak',
      },
    }), undefined)
  })
})
