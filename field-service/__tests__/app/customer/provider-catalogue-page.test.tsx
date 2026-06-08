import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const {
  mockGetSession,
  mockIsEnabled,
  mockProviderFindMany,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockProviderFindMany: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findMany: mockProviderFindMany,
    },
  },
}))

describe('provider catalogue customer search handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockIsEnabled.mockResolvedValue(false)
    mockProviderFindMany.mockResolvedValue([])
  })

  it('redirects a disabled provider-browse search into the request flow with query and area preserved', async () => {
    const Page = (await import('@/app/(customer)/providers/page')).default

    await expect(
      Page({
        searchParams: Promise.resolve({
          q: 'Tiler',
          area: 'gauteng__johannesburg__jhb_west__little_falls',
        }),
      }),
    ).rejects.toThrow(
      'redirect:/book/tiling?area=gauteng__johannesburg__jhb_west__little_falls&q=Tiler',
    )

    expect(mockProviderFindMany).not.toHaveBeenCalled()
  })

  it('shows a no-results continue-request state when provider browse is enabled but no exact match is found', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const Page = (await import('@/app/(customer)/providers/page')).default

    const html = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({
          q: 'Tiler',
          area: 'gauteng__johannesburg__jhb_west__little_falls',
        }),
      }),
    )

    expect(html).toContain('We could not find an exact match in Little Falls yet')
    expect(html).toContain('You can still send the request')
    expect(html).toContain('/book/tiling?area=gauteng__johannesburg__jhb_west__little_falls&amp;q=Tiler')
  })
})
