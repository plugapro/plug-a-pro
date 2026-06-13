import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomerLayout from '@/app/(customer)/layout'
import type { BottomNavItem } from '@/components/shared/bottom-nav'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockProviderFindFirst,
  mockCustomerFindUnique,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockCustomerFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findFirst: mockProviderFindFirst,
    },
    customer: {
      findUnique: mockCustomerFindUnique,
    },
  },
}))

vi.mock('@/components/shared/app-logo', () => ({
  AppLogo: () => <div>Plug A Pro</div>,
}))

vi.mock('@/components/customer/BusinessTypePrompt', () => ({
  BusinessTypePrompt: () => <div>Business prompt</div>,
}))

vi.mock('@/components/shared/bottom-nav', () => ({
  BottomNav: ({ items }: { items: BottomNavItem[] }) => (
    <nav data-testid="bottom-nav">
      {items.map((item) => (
        <a key={item.id} href={item.href} data-id={item.id}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}))

vi.mock('@/components/shared/AuthRefresh', () => ({
  AuthRefresh: () => null,
}))

describe('customer layout auth-aware navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockResolveCustomerForSession.mockResolvedValue(null)
    mockProviderFindFirst.mockResolvedValue(null)
    mockCustomerFindUnique.mockResolvedValue(null)
  })

  it('shows Sign in affordances for logged-out visitors', async () => {
    const html = renderToStaticMarkup(await CustomerLayout({ children: <div>home</div> }))

    expect(html).toContain('Sign in')
    expect(html).not.toContain('Bookings')
    expect(html).not.toContain('Profile')
  })

  it('shows customer navigation for logged-in customers', async () => {
    mockGetSession.mockResolvedValue({ id: 'u-1', role: 'customer', phone: '+27825550000' })
    mockResolveCustomerForSession.mockResolvedValue({
      id: 'c-1',
      name: 'Sarah M',
      phone: '+27825550000',
    })
    mockCustomerFindUnique.mockResolvedValue({
      businessName: 'Sarah Co',
      createdAt: new Date('2026-05-10T08:00:00.000Z'),
    })

    const html = renderToStaticMarkup(await CustomerLayout({ children: <div>home</div> }))

    expect(html).toContain('Bookings')
    expect(html).toContain('Profile')
    expect(html).toContain('/bookings')
    expect(html).toContain('/profile')
  })

  it('shows provider-first navigation for provider sessions', async () => {
    mockGetSession.mockResolvedValue({ id: 'u-2', role: 'provider', phone: '+27826660000' })
    mockProviderFindFirst.mockResolvedValue({ id: 'p-1', name: 'Lovemore' })

    const html = renderToStaticMarkup(await CustomerLayout({ children: <div>home</div> }))

    expect(html).toContain('Dashboard')
    expect(html).toContain('Jobs')
    expect(html).toContain('/provider/profile')
  })

  it('shows context-switch navigation for multi-role users', async () => {
    mockGetSession.mockResolvedValue({ id: 'u-3', role: 'provider', phone: '+27827770000' })
    mockProviderFindFirst.mockResolvedValue({ id: 'p-3', name: 'Thabo' })
    mockResolveCustomerForSession.mockResolvedValue({
      id: 'c-3',
      name: 'Thabo',
      phone: '+27827770000',
    })
    mockCustomerFindUnique.mockResolvedValue({
      businessName: 'Thabo Services',
      createdAt: new Date('2026-05-10T08:00:00.000Z'),
    })

    const html = renderToStaticMarkup(await CustomerLayout({ children: <div>home</div> }))

    expect(html).toContain('Request')
    expect(html).toContain('Provider')
    expect(html).toContain('/provider')
    expect(html).toContain('/profile')
  })
})
