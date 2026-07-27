// Page-level access-gate tests for /provider/board. Renders the actual page
// component with mocked deps (same pattern as
// __tests__/provider/provider-identity-verify-page.test.tsx) so the
// flag-gate / auth-gate / privacy-safe rendering behaviour is verified
// against the real page module, not a re-implementation of its logic.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled, mockRequireProvider, mockDb, mockFindBoardJobsForProvider } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockRequireProvider: vi.fn(),
  mockDb: {
    provider: { findUnique: vi.fn() },
  },
  mockFindBoardJobsForProvider: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/auth', () => ({ requireProvider: mockRequireProvider }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/board/eligibility', () => ({ findBoardJobsForProvider: mockFindBoardJobsForProvider }))

describe('/provider/board page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireProvider.mockResolvedValue({ id: 'user-1', role: 'provider' })
    mockDb.provider.findUnique.mockResolvedValue({ id: 'p1', skills: ['plumbing'] })
    mockFindBoardJobsForProvider.mockResolvedValue([])
  })

  it('404s when the provider.board.v1 flag is off, before touching auth or the DB', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const Page = (await import('@/app/(provider)/provider/board/page')).default

    await expect(
      Page({ searchParams: Promise.resolve({}) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404') })

    expect(mockRequireProvider).not.toHaveBeenCalled()
    expect(mockDb.provider.findUnique).not.toHaveBeenCalled()
  })

  it('shows a setup notice instead of crashing when the session has no provider row', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockDb.provider.findUnique.mockResolvedValue(null)
    const Page = (await import('@/app/(provider)/provider/board/page')).default

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))

    expect(html).toContain('Provider account not set up')
    expect(mockFindBoardJobsForProvider).not.toHaveBeenCalled()
  })

  it('renders the empty state when no jobs are eligible', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockFindBoardJobsForProvider.mockResolvedValue([])
    const Page = (await import('@/app/(provider)/provider/board/page')).default

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))

    expect(html).toContain('No open jobs right now')
  })

  it('renders only privacy-safe BoardJob fields for eligible jobs - no customer identity leaks', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockFindBoardJobsForProvider.mockResolvedValue([
      {
        id: 'jr1',
        category: 'plumbing',
        title: 'Burst geyser',
        description: 'Geyser burst in the roof, water everywhere',
        suburbLabel: 'Ruimsig',
        requestedWindowStart: null,
        requestedWindowEnd: null,
        createdAt: new Date('2026-07-20T12:00:00Z'),
        interestCount: 1,
      },
    ])
    const Page = (await import('@/app/(provider)/provider/board/page')).default

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))

    expect(html).toContain('Burst geyser')
    expect(html).toContain('Ruimsig')
    expect(html).toContain('1/3 interested')
    // No customer PII fields (name/phone/address/notes) are part of BoardJob at all,
    // so nothing to assert an exclusion of beyond the shape already returned above.
  })

  it('passes the category and suburb query search params through to the eligibility query', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const Page = (await import('@/app/(provider)/provider/board/page')).default

    await Page({ searchParams: Promise.resolve({ category: 'plumbing', q: 'Ruimsig' }) })

    expect(mockFindBoardJobsForProvider).toHaveBeenCalledWith(
      mockDb,
      'p1',
      { category: 'plumbing', suburbQuery: 'Ruimsig' },
    )
  })
})
