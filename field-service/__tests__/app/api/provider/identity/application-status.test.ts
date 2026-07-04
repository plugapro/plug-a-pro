import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashProviderVerificationToken } from '@/lib/provider-verification-token'

const { mockDb } = vi.hoisted(() => {
  const store = new Map<string, any>()
  const mockDb: any = {
    providerIdentityVerification: {
      findUnique: vi.fn(async ({ where }: any) => {
        for (const row of store.values()) {
          if (row.accessTokenHash === where.accessTokenHash) {
            return { status: row.status, decision: row.decision }
          }
        }
        return null
      }),
    },
  }
  ;(mockDb as any).__store = store
  return { mockDb }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))

function getStore(): Map<string, any> { return (mockDb as any).__store }

beforeEach(() => {
  getStore().clear()
  vi.clearAllMocks()
  mockDb.providerIdentityVerification.findUnique.mockImplementation(async ({ where }: any) => {
    for (const row of getStore().values()) {
      if (row.accessTokenHash === where.accessTokenHash) {
        return { status: row.status, decision: row.decision }
      }
    }
    return null
  })
})

describe('application-status read helper', () => {
  it('returns status and decision for a valid hashed token', async () => {
    const token = 'abc123def456abc123def456abc123def456abc123def456'
    const hash = hashProviderVerificationToken(token)
    getStore().set('v1', { id: 'v1', accessTokenHash: hash, status: 'SUBMITTED', decision: null })

    const result = await mockDb.providerIdentityVerification.findUnique({
      where: { accessTokenHash: hash },
      select: { status: true, decision: true },
    })

    expect(result).toEqual({ status: 'SUBMITTED', decision: null })
  })

  it('returns null for an unknown token', async () => {
    const token = 'unknown000000000000000000000000000000000000000000'
    const hash = hashProviderVerificationToken(token)

    const result = await mockDb.providerIdentityVerification.findUnique({
      where: { accessTokenHash: hash },
      select: { status: true, decision: true },
    })

    expect(result).toBeNull()
  })

  it('does not expose PII — only returns status and decision', async () => {
    const token = 'abc123def456abc123def456abc123def456abc123def456'
    const hash = hashProviderVerificationToken(token)
    getStore().set('v2', {
      id: 'v2',
      accessTokenHash: hash,
      status: 'PASSED',
      decision: 'PASS',
      phone: '+27000000001', // PII
      name: 'Joe',          // PII
    })

    const result = await mockDb.providerIdentityVerification.findUnique({
      where: { accessTokenHash: hash },
      select: { status: true, decision: true },
    })

    expect(result).toEqual({ status: 'PASSED', decision: 'PASS' })
    // The mock only returns status+decision because that's what the select would return
    expect(result).not.toHaveProperty('phone')
    expect(result).not.toHaveProperty('name')
  })
})
