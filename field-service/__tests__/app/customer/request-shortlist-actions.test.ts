/**
 * Tests for the authenticated customer shortlist actions
 * app/(customer)/requests/[id]/actions.ts
 *
 * Verifies that:
 * - Each action enforces session authentication and request ownership
 * - Each action delegates to the corresponding customer-shortlists lib function
 * - selectShortlistProviderAction advances the request to PROVIDER_CONFIRMATION_PENDING
 * - requestMoreShortlistOptionsAction returns the request to OPEN
 * - cancelRequestFromShortlistAction cancels the request
 * - CustomerShortlistError messages are forwarded to the caller as { error }
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockGetSession, mockResolveCustomerForSession } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
    customer: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
}))

const {
  mockSelectShortlistedProviderForRequest,
  mockSelectProviderForCustomerRequest,
  mockRequestMoreShortlistOptions,
  mockCancelRequestFromShortlist,
  MockCustomerShortlistError,
} = vi.hoisted(() => {
  class MockCustomerShortlistError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'CustomerShortlistError'
    }
    }
  return {
    mockSelectShortlistedProviderForRequest: vi.fn(),
    mockSelectProviderForCustomerRequest: vi.fn(),
    mockRequestMoreShortlistOptions: vi.fn(),
    mockCancelRequestFromShortlist: vi.fn(),
    MockCustomerShortlistError,
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))
vi.mock('@/lib/customer-shortlists', () => ({
  selectShortlistedProviderForRequest: mockSelectShortlistedProviderForRequest,
  selectProviderForCustomerRequest: mockSelectProviderForCustomerRequest,
  requestMoreShortlistOptions: mockRequestMoreShortlistOptions,
  cancelRequestFromShortlist: mockCancelRequestFromShortlist,
  CustomerShortlistError: MockCustomerShortlistError,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function makeSession() {
  return { id: 'user-1', role: 'customer' as const }
}

function makeCustomer() {
  return { id: 'customer-1', userId: 'user-1', phone: '+27111111111', name: 'Test', email: null }
}

function makeJobRequest(customerId = 'customer-1') {
  return { customerId }
}

describe('authenticated request shortlist actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(makeSession())
    mockResolveCustomerForSession.mockResolvedValue(makeCustomer())
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest())
    mockSelectShortlistedProviderForRequest.mockResolvedValue({ selectedItem: { id: 'item-1' }, provider: {}, notification: { sent: true } })
    mockSelectProviderForCustomerRequest.mockResolvedValue({
      requestId: 'request-1',
      providerId: 'provider-1',
      leadId: 'lead-1',
      alreadySelected: false,
    })
    mockRequestMoreShortlistOptions.mockResolvedValue({ ok: true })
    mockCancelRequestFromShortlist.mockResolvedValue({ ok: true })
  })

  describe('selectShortlistProviderAction', () => {
    it('resolves without error on success and delegates to selectShortlistedProviderForRequest', async () => {
      const { selectShortlistProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectShortlistProviderAction('request-1', 'item-1', new FormData()),
      ).resolves.toBeUndefined()
      expect(mockSelectShortlistedProviderForRequest).toHaveBeenCalledWith({
        requestId: 'request-1',
        shortlistItemId: 'item-1',
      })
    })

    it('throws on empty request or shortlist identifiers', async () => {
      const { selectShortlistProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectShortlistProviderAction('  ', 'item-1', new FormData()),
      ).rejects.toThrow('Invalid selection request')
      await expect(
        selectShortlistProviderAction('request-1', '  ', new FormData()),
      ).rejects.toThrow('Invalid selection request')
      expect(mockSelectShortlistedProviderForRequest).not.toHaveBeenCalled()
    })

    it('throws when the session is missing', async () => {
      mockGetSession.mockResolvedValueOnce(null)
      const { selectShortlistProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectShortlistProviderAction('request-1', 'item-1', new FormData()),
      ).rejects.toThrow()
      expect(mockSelectShortlistedProviderForRequest).not.toHaveBeenCalled()
    })

    it('throws when the customer does not own the request', async () => {
      mockDb.jobRequest.findUnique.mockResolvedValueOnce({ customerId: 'different-customer' })
      const { selectShortlistProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectShortlistProviderAction('request-1', 'item-1', new FormData()),
      ).rejects.toThrow()
      expect(mockSelectShortlistedProviderForRequest).not.toHaveBeenCalled()
    })

    it('re-throws CustomerShortlistError to caller', async () => {
      mockSelectShortlistedProviderForRequest.mockRejectedValueOnce(
        new MockCustomerShortlistError('REQUEST_NOT_AWAITING_SELECTION', 'This request is no longer awaiting selection.'),
      )
      const { selectShortlistProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectShortlistProviderAction('request-1', 'item-1', new FormData()),
      ).rejects.toThrow('This request is no longer awaiting selection.')
    })
  })

  describe('requestMoreShortlistOptionsAction', () => {
    it('resolves without error on success and delegates to requestMoreShortlistOptions', async () => {
      const { requestMoreShortlistOptionsAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        requestMoreShortlistOptionsAction('request-1', new FormData()),
      ).resolves.toBeUndefined()
      expect(mockRequestMoreShortlistOptions).toHaveBeenCalledWith({ requestId: 'request-1' })
    })

    it('throws when the session is missing', async () => {
      mockGetSession.mockResolvedValueOnce(null)
      const { requestMoreShortlistOptionsAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        requestMoreShortlistOptionsAction('request-1', new FormData()),
      ).rejects.toThrow()
      expect(mockRequestMoreShortlistOptions).not.toHaveBeenCalled()
    })

    it('re-throws CustomerShortlistError to caller', async () => {
      mockRequestMoreShortlistOptions.mockRejectedValueOnce(
        new MockCustomerShortlistError('REQUEST_NOT_AWAITING_SELECTION', 'More options can only be requested while the shortlist is awaiting selection.'),
      )
      const { requestMoreShortlistOptionsAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        requestMoreShortlistOptionsAction('request-1', new FormData()),
      ).rejects.toThrow('More options can only be requested while the shortlist is awaiting selection.')
    })
  })

  describe('selectMatchedProviderAction', () => {
    it('resolves without error and delegates to selectProviderForCustomerRequest', async () => {
      const { selectMatchedProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectMatchedProviderAction(' request-1 ', ' provider-1 ', new FormData()),
      ).resolves.toBeUndefined()
      expect(mockSelectProviderForCustomerRequest).toHaveBeenCalledWith({
        requestId: 'request-1',
        customerId: 'customer-1',
        providerId: 'provider-1',
      })
      expect(mockSelectShortlistedProviderForRequest).not.toHaveBeenCalled()
    })

    it('throws on empty request or provider identifiers', async () => {
      const { selectMatchedProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectMatchedProviderAction('  ', 'provider-1', new FormData()),
      ).rejects.toThrow('Invalid selection request')
      await expect(
        selectMatchedProviderAction('request-1', '  ', new FormData()),
      ).rejects.toThrow('Invalid selection request')
      expect(mockSelectShortlistedProviderForRequest).not.toHaveBeenCalled()
      expect(mockSelectProviderForCustomerRequest).not.toHaveBeenCalled()
    })

    it('throws when session is missing', async () => {
      mockGetSession.mockResolvedValueOnce(null)
      const { selectMatchedProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectMatchedProviderAction('request-1', 'provider-1', new FormData()),
      ).rejects.toThrow()
      expect(mockSelectProviderForCustomerRequest).not.toHaveBeenCalled()
    })

    it('throws when the customer does not own the request', async () => {
      mockDb.jobRequest.findUnique.mockResolvedValueOnce({
        customerId: 'different-customer',
      })
      const { selectMatchedProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectMatchedProviderAction('request-1', 'provider-1', new FormData()),
      ).rejects.toThrow()
      expect(mockSelectProviderForCustomerRequest).not.toHaveBeenCalled()
    })

    it('re-throws CustomerShortlistError to caller', async () => {
      mockSelectProviderForCustomerRequest.mockRejectedValueOnce(
        new MockCustomerShortlistError(
          'REQUEST_NOT_AWAITING_SELECTION',
          'This request is no longer awaiting selection.',
        ),
      )
      const { selectMatchedProviderAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        selectMatchedProviderAction('request-1', 'provider-1', new FormData()),
      ).rejects.toThrow('This request is no longer awaiting selection.')
    })
  })

  describe('cancelRequestFromShortlistAction', () => {
    it('resolves without error on success and delegates to cancelRequestFromShortlist', async () => {
      const { cancelRequestFromShortlistAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        cancelRequestFromShortlistAction('request-1', new FormData()),
      ).resolves.toBeUndefined()
      expect(mockCancelRequestFromShortlist).toHaveBeenCalledWith({ requestId: 'request-1' })
    })

    it('throws when the customer does not own the request', async () => {
      mockDb.jobRequest.findUnique.mockResolvedValueOnce({ customerId: 'different-customer' })
      const { cancelRequestFromShortlistAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        cancelRequestFromShortlistAction('request-1', new FormData()),
      ).rejects.toThrow()
      expect(mockCancelRequestFromShortlist).not.toHaveBeenCalled()
    })

    it('re-throws CustomerShortlistError when provider confirmation is pending', async () => {
      mockCancelRequestFromShortlist.mockRejectedValueOnce(
        new MockCustomerShortlistError('REQUEST_NOT_AWAITING_SELECTION', 'This request can no longer be cancelled here.'),
      )
      const { cancelRequestFromShortlistAction } = await import(
        '@/app/(customer)/requests/[id]/actions'
      )
      await expect(
        cancelRequestFromShortlistAction('request-1', new FormData()),
      ).rejects.toThrow('This request can no longer be cancelled here.')
    })
  })
})
