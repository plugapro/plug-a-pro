import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

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
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockResolveReusableCustomerSites: vi.fn(),
  mockJobRequestFindFirst: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockLocationNodeFindFirst: vi.fn(),
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
    locationNode: {
      findFirst: mockLocationNodeFindFirst,
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
    mockLocationNodeFindFirst.mockResolvedValue(null)
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

  it('prefills the booking flow from a home search service alias and selected area', async () => {
    mockLocationNodeFindFirst.mockResolvedValue({
      id: 'loc-little-falls',
      label: 'little falls',
      postalCode: '1724',
      parent: {
        label: 'jhb west',
        parent: {
          label: 'johannesburg',
          parent: { label: 'gauteng' },
        },
      },
    })

    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'tiling' }),
        searchParams: Promise.resolve({
          q: 'Tiler',
          area: 'gauteng__johannesburg__jhb_west__little_falls',
        }),
      }),
    )

    expect(mockLocationNodeFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        slug: 'gauteng__johannesburg__jhb_west__little_falls',
        nodeType: 'SUBURB',
        active: true,
      }),
    }))
    expect(mockBookingFlow).toHaveBeenCalledWith(expect.objectContaining({
      initialDraft: expect.objectContaining({
        subcategory: 'Tiler',
      }),
      initialAddress: {
        locationNodeId: 'loc-little-falls',
        suburb: 'Little Falls',
        region: 'JHB West',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '1724',
      },
    }), undefined)
  })

  it('allows unknown home-search skills to continue through the Other request flow', async () => {
    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'other' }),
        searchParams: Promise.resolve({ q: 'Solar geyser repair' }),
      }),
    )

    expect(mockNotFound).not.toHaveBeenCalled()
    expect(mockBookingFlow).toHaveBeenCalledWith(expect.objectContaining({
      category: expect.objectContaining({
        slug: 'other',
        name: 'Other',
      }),
      initialDraft: expect.objectContaining({
        title: 'Solar geyser repair',
        subcategory: 'Solar geyser repair',
      }),
    }), undefined)
  })

  it('surfaces a safe fallback label when the selected area cannot be resolved', async () => {
    mockLocationNodeFindFirst.mockResolvedValue(null)
    const Page = (await import('@/app/(customer)/book/[serviceId]/page')).default

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ serviceId: 'tiling' }),
        searchParams: Promise.resolve({
          q: 'Tiler',
          area: 'gauteng__johannesburg__jhb_west__little_falls',
        }),
      }),
    )

    expect(mockBookingFlow).toHaveBeenCalledWith(expect.objectContaining({
      initialAddress: null,
      initialAreaLabel: 'Little Falls',
    }), undefined)
  })
})
