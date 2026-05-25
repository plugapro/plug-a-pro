// Unit tests for linkCustomerAccount — the real creation/linking logic.
//
// Regression guard for the "provider shown as Customer" bug: a provider who
// reaches the customer sign-in flow must NOT have a spurious Customer record
// auto-created. Linking a pre-existing Customer row is still allowed (that is a
// genuine multi-role customer, not creation).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    provider: {
      findFirst: vi.fn(),
    },
  },
}))

// auth.ts loads @supabase/supabase-js at module scope; stub it like auth.test.ts.
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/internal-test-cohort', () => ({
  createTestCohortContext: () => ({ isTestUser: false, cohortName: null }),
}))

import { linkCustomerAccount } from '../../lib/auth'

describe('linkCustomerAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.customer.findUnique.mockResolvedValue(null)
    mockDb.provider.findFirst.mockResolvedValue(null)
  })

  it('does NOT create a customer for a provider-only account', async () => {
    // No customer by userId, none by phone, but the user is a provider.
    mockDb.provider.findFirst.mockResolvedValue({ id: 'prov-1' })

    const result = await linkCustomerAccount({ userId: 'u1', phone: '+27821234567' })

    expect(result).toEqual({ id: null, isNew: false, isProviderOnly: true })
    expect(mockDb.customer.create).not.toHaveBeenCalled()
  })

  it('creates a customer for a brand-new non-provider account', async () => {
    mockDb.customer.create.mockResolvedValue({ id: 'cust-new' })

    const result = await linkCustomerAccount({ userId: 'u1', phone: '+27821234567', name: 'Jane' })

    expect(mockDb.customer.create).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ id: 'cust-new', isNew: true })
  })

  it('links an existing phone-only customer without creating (and without needing the provider check)', async () => {
    mockDb.customer.findUnique
      .mockResolvedValueOnce(null) // lookup by userId
      .mockResolvedValueOnce({ id: 'cust-existing', userId: null, name: 'WhatsApp Customer' }) // by phone
    mockDb.customer.update.mockResolvedValue({ id: 'cust-existing' })

    const result = await linkCustomerAccount({ userId: 'u1', phone: '+27821234567', name: 'Jane' })

    expect(result).toEqual({ id: 'cust-existing', isNew: false })
    expect(mockDb.customer.create).not.toHaveBeenCalled()
    // Existing-record branch returns before the provider guard runs.
    expect(mockDb.provider.findFirst).not.toHaveBeenCalled()
  })

  it('is idempotent when the userId is already linked', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce({ id: 'cust-1' }) // by userId

    const result = await linkCustomerAccount({ userId: 'u1', phone: '+27821234567' })

    expect(result).toEqual({ id: 'cust-1', isNew: false })
    expect(mockDb.customer.create).not.toHaveBeenCalled()
    expect(mockDb.provider.findFirst).not.toHaveBeenCalled()
  })
})
