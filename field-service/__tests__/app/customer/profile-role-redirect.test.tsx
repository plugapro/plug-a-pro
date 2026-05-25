// Regression: a provider must never be rendered through the customer /profile
// page (which would label them "Customer"). /profile is role-aware and redirects
// provider sessions to /provider/profile. Covers manual URL edits / deep links /
// refresh, since the guard runs on every server render.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetSession, mockResolveCustomerForSession, mockJobRequestCount, mockRedirect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockJobRequestCount: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/customer-session', () => ({ resolveCustomerForSession: mockResolveCustomerForSession }))
vi.mock('@/lib/db', () => ({ db: { jobRequest: { count: mockJobRequestCount } } }))
vi.mock('@/app/(customer)/profile/WhatsappPreferencesCard', () => ({ WhatsappPreferencesCard: () => null }))
vi.mock('@/components/customer/SignOutButton', () => ({ SignOutButton: () => null }))
vi.mock('@/components/shared/theme-toggle', () => ({ ThemeToggle: () => null }))

describe('/profile role-aware redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveCustomerForSession.mockResolvedValue(null)
    mockJobRequestCount.mockResolvedValue(0)
  })

  it('redirects a provider session to /provider/profile', async () => {
    mockGetSession.mockResolvedValue({ id: 'u1', role: 'provider', phone: '+27823035070', providerId: 'prov-1' })
    const Page = (await import('@/app/(customer)/profile/page')).default

    await expect(Page()).rejects.toThrow('redirect:/provider/profile')
    expect(mockRedirect).toHaveBeenCalledWith('/provider/profile')
  })

  it('redirects an unauthenticated visitor to sign-in', async () => {
    mockGetSession.mockResolvedValue(null)
    const Page = (await import('@/app/(customer)/profile/page')).default

    await expect(Page()).rejects.toThrow('redirect:/sign-in')
  })

  it('renders the customer profile (no provider redirect) for a customer session', async () => {
    mockGetSession.mockResolvedValue({ id: 'u2', role: 'customer', phone: '+27821234567' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1', name: 'Sarah', email: null, phone: '+27821234567' })
    const Page = (await import('@/app/(customer)/profile/page')).default

    const html = renderToStaticMarkup(await Page())

    expect(html).toContain('Sarah')
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
