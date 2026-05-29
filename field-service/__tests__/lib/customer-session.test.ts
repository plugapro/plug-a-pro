import { describe, expect, it, vi, beforeEach } from 'vitest'

import { resolveCustomerForSession } from '@/lib/customer-session'

// ─── flag mock ───────────────────────────────────────────────────────────────
// Default: operator_member flag is OFF. Individual tests override as needed.
vi.mock('@/lib/flags', () => ({
  isEnabled: vi.fn().mockResolvedValue(false),
}))

import { isEnabled } from '@/lib/flags'
const mockIsEnabled = isEnabled as ReturnType<typeof vi.fn>

// ─── shared fixture builders ─────────────────────────────────────────────────

function makeCustomerRecord(overrides: Partial<{
  id: string; userId: string | null; phone: string; name: string; email: string | null
}> = {}) {
  return {
    id: 'cust_1',
    userId: null,
    phone: '+27821234567',
    name: 'Test Customer',
    email: null,
    ...overrides,
  }
}

function makeSession(overrides: Partial<{
  id: string; email: string | null; phone: string | null; role: 'customer'
}> = {}) {
  return {
    id: 'user_1',
    email: null,
    phone: '+27821234567',
    role: 'customer' as const,
    ...overrides,
  }
}

function makeClient(
  overrides: {
    findUniqueResults?: Array<ReturnType<typeof makeCustomerRecord> | null>
    updateResult?: ReturnType<typeof makeCustomerRecord>
    memberResult?: { principalCustomerId: string } | null
  } = {}
) {
  const { findUniqueResults = [null], updateResult = null, memberResult = null } = overrides
  const findUnique = vi.fn()
  for (const r of findUniqueResults) findUnique.mockResolvedValueOnce(r)
  findUnique.mockResolvedValue(null) // fallback for extra calls

  return {
    customer: {
      findUnique,
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(updateResult),
    },
    customerMember: {
      findFirst: vi.fn().mockResolvedValue(memberResult),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsEnabled.mockResolvedValue(false)
})

// ─── existing behaviour (flag off) ───────────────────────────────────────────

describe('resolveCustomerForSession - direct resolution (flag off)', () => {
  it('resolves by userId when customer exists', async () => {
    const rec = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({ findUniqueResults: [rec] })

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(result?.id).toBe('cust_1')
    expect(client.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1' } }),
    )
  })

  it('falls back to phone when userId lookup misses and self-links the record', async () => {
    const rec = makeCustomerRecord({ phone: '+27821234567', userId: null })
    const linked = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({ findUniqueResults: [null, rec], updateResult: linked })

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(result?.id).toBe('cust_1')
    expect(client.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '+27821234567' } }),
    )
    expect(client.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user_1' } }),
    )
  })

  it('returns null when both lookups miss', async () => {
    const client = makeClient({ findUniqueResults: [null, null] })
    const result = await resolveCustomerForSession(client as never, makeSession())
    expect(result).toBeNull()
  })

  it('self-links a phone-only customer (userId=null) after phone match', async () => {
    const rec = makeCustomerRecord({ userId: null })
    const linked = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({ findUniqueResults: [null, rec], updateResult: linked })

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(client.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cust_1' }, data: { userId: 'user_1' } }),
    )
    expect(result?.userId).toBe('user_1')
  })

  it('does not self-link when userId is already set', async () => {
    const rec = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({ findUniqueResults: [rec] })

    await resolveCustomerForSession(client as never, makeSession())

    expect(client.customer.update).not.toHaveBeenCalled()
  })

  it('does not query customerMember when flag is off', async () => {
    const rec = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({ findUniqueResults: [rec] })

    await resolveCustomerForSession(client as never, makeSession())

    expect(client.customerMember.findFirst).not.toHaveBeenCalled()
  })

  it('skips phone fallback when session.phone is null', async () => {
    const client = makeClient({ findUniqueResults: [null] })
    const result = await resolveCustomerForSession(
      client as never,
      makeSession({ phone: null }),
    )
    expect(client.customer.findUnique).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })
})

// ─── M1-T8: CustomerMember operator delegation (flag on) ─────────────────────

describe('resolveCustomerForSession - operator member delegation (flag on)', () => {
  beforeEach(() => {
    mockIsEnabled.mockResolvedValue(true)
  })

  it('resolves to principal customer even when member has their own Customer record', async () => {
    const ownRec = makeCustomerRecord({ id: 'cust_member', userId: 'user_1' })
    const principalRec = makeCustomerRecord({ id: 'cust_principal', userId: 'user_org' })
    const client = makeClient({
      findUniqueResults: [ownRec, principalRec],
      memberResult: { principalCustomerId: 'cust_principal' },
    })

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(result?.id).toBe('cust_principal')
  })

  it('resolves to principal customer when memberUserId matches', async () => {
    const principalRec = makeCustomerRecord({ id: 'cust_principal', userId: 'user_org' })
    const client = makeClient({
      findUniqueResults: [null, principalRec],
      memberResult: { principalCustomerId: 'cust_principal' },
    })

    const result = await resolveCustomerForSession(
      client as never,
      makeSession({ phone: null }),
    )

    expect(result?.id).toBe('cust_principal')
  })

  it('queries customerMember by memberUserId only (no phone OR clause)', async () => {
    const client = makeClient({
      findUniqueResults: [null, null],
      memberResult: null,
    })

    await resolveCustomerForSession(client as never, makeSession())

    expect(client.customerMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberUserId: 'user_1', active: true },
      }),
    )
  })

  it('falls back to direct customer when no membership exists', async () => {
    const ownRec = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({
      findUniqueResults: [ownRec],
      memberResult: null,
    })

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(result?.id).toBe('cust_1')
  })

  it('returns null when no membership AND no direct customer', async () => {
    const client = makeClient({
      findUniqueResults: [null, null],
      memberResult: null,
    })

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(result).toBeNull()
  })

  it('returns null when membership found but principal lookup fails', async () => {
    const client = makeClient({
      findUniqueResults: [null, null, null],
      memberResult: { principalCustomerId: 'cust_principal' },
    })

    const result = await resolveCustomerForSession(client as never, makeSession())

    // Principal lookup returned null - should return null, not throw
    expect(result).toBeNull()
  })

  it('does NOT self-link member userId to a phone-only record when member delegation occurs', async () => {
    // Principal has no userId yet (phone-only record). Delegation returns it directly;
    // the self-link path (userId=null → update) is never reached because the early
    // return from delegation bypasses it.
    const phoneOnlyPrincipal = makeCustomerRecord({ id: 'cust_principal', userId: null })
    const client = makeClient({
      // [0] userId lookup → null, [1] delegation's principal lookup → phoneOnlyPrincipal
      findUniqueResults: [null, phoneOnlyPrincipal],
      memberResult: { principalCustomerId: 'cust_principal' },
    })

    await resolveCustomerForSession(client as never, makeSession())

    expect(client.customer.update).not.toHaveBeenCalled()
  })

  it('passes userId to isEnabled for per-user rollout support', async () => {
    const client = makeClient({ findUniqueResults: [null, null], memberResult: null })

    await resolveCustomerForSession(client as never, makeSession())

    expect(mockIsEnabled).toHaveBeenCalledWith(
      'feature.customer.operator_member',
      expect.objectContaining({ userId: 'user_1' }),
    )
  })

  it('skips member lookup when customerMember is not on the client', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const rec = makeCustomerRecord({ userId: 'user_1' })
    // Client without customerMember (legacy test pattern)
    const client = {
      customer: {
        findUnique: vi.fn().mockResolvedValue(rec),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    }

    const result = await resolveCustomerForSession(client as never, makeSession())

    expect(result?.id).toBe('cust_1')
  })

  it('falls back to direct resolution when resolveMemberDelegation throws', async () => {
    const ownRec = makeCustomerRecord({ userId: 'user_1' })
    const client = makeClient({ findUniqueResults: [ownRec] })
    client.customerMember.findFirst.mockRejectedValueOnce(new Error('DB timeout'))

    const result = await resolveCustomerForSession(client as never, makeSession())

    // Despite the delegation error, the member's own customer record is returned
    expect(result?.id).toBe('cust_1')
  })
})
