import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hashProviderResumeToken } from '@/lib/provider-resume-tokens'

// ─── In-memory DB state ───────────────────────────────────────────────────────

type TokenRow = {
  id: string
  tokenHash: string
  conversationId: string
  phone: string
  issuedByAdminUserId: string
  issuedAt: Date
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
  revokedReason: string | null
  source: string
}

let tokenStore: Map<string, TokenRow> = new Map()
let idSeq = 0

function nextId() {
  return `tok-${++idSeq}`
}

const mockDb = {
  providerResumeToken: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
      if (where.id) return tokenStore.get(where.id) ?? null
      if (where.tokenHash) {
        for (const row of tokenStore.values()) {
          if (row.tokenHash === where.tokenHash) return row
        }
        return null
      }
      return null
    }),
    create: vi.fn(async ({ data, select }: { data: Omit<TokenRow, 'id' | 'issuedAt'>; select?: Record<string, boolean> }) => {
      const id = nextId()
      const row: TokenRow = {
        id,
        tokenHash: data.tokenHash,
        conversationId: data.conversationId,
        phone: data.phone,
        issuedByAdminUserId: data.issuedByAdminUserId,
        issuedAt: new Date(),
        expiresAt: data.expiresAt,
        usedAt: data.usedAt ?? null,
        revokedAt: data.revokedAt ?? null,
        revokedReason: data.revokedReason ?? null,
        source: data.source,
      }
      tokenStore.set(id, row)
      if (select?.id) return { id }
      return row
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<TokenRow> }) => {
      const row = tokenStore.get(where.id)
      if (!row) throw new Error(`Row not found: ${where.id}`)
      Object.assign(row, data)
      return row
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) => {
      let count = 0
      for (const row of tokenStore.values()) {
        if (where.conversationId && row.conversationId !== where.conversationId) continue
        if (where.id && row.id !== where.id) continue
        if ('usedAt' in where && where.usedAt === null && row.usedAt !== null) continue
        if ('revokedAt' in where && where.revokedAt === null && row.revokedAt !== null) continue
        if (where.expiresAt && typeof where.expiresAt === 'object' && 'gt' in (where.expiresAt as Record<string, unknown>)) {
          const gt = (where.expiresAt as { gt: Date }).gt
          if (row.expiresAt.getTime() <= gt.getTime()) continue
        }
        Object.assign(row, data)
        count++
      }
      return { count }
    }),
    findMany: vi.fn(async ({ where }: { where: { conversationId: string } }) => {
      const results: TokenRow[] = []
      for (const row of tokenStore.values()) {
        if (where.conversationId && row.conversationId !== where.conversationId) continue
        results.push(row)
      }
      return results
    }),
    deleteMany: vi.fn(async () => {
      const count = tokenStore.size
      tokenStore.clear()
      return { count }
    }),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb)),
}

vi.mock('@/lib/db', () => ({ db: mockDb }))

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  tokenStore = new Map()
  idSeq = 0
  vi.clearAllMocks()
  // Re-attach implementations after clearAllMocks
  mockDb.providerResumeToken.findUnique.mockImplementation(
    async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
      if (where.id) return tokenStore.get(where.id) ?? null
      if (where.tokenHash) {
        for (const row of tokenStore.values()) {
          if (row.tokenHash === where.tokenHash) return row
        }
        return null
      }
      return null
    },
  )
  mockDb.providerResumeToken.create.mockImplementation(
    async ({ data, select }: { data: Omit<TokenRow, 'id' | 'issuedAt'>; select?: Record<string, boolean> }) => {
      const id = nextId()
      const row: TokenRow = {
        id,
        tokenHash: data.tokenHash,
        conversationId: data.conversationId,
        phone: data.phone,
        issuedByAdminUserId: data.issuedByAdminUserId,
        issuedAt: new Date(),
        expiresAt: data.expiresAt,
        usedAt: data.usedAt ?? null,
        revokedAt: data.revokedAt ?? null,
        revokedReason: data.revokedReason ?? null,
        source: data.source,
      }
      tokenStore.set(id, row)
      if (select?.id) return { id }
      return row
    },
  )
  mockDb.providerResumeToken.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Partial<TokenRow> }) => {
      const row = tokenStore.get(where.id)
      if (!row) throw new Error(`Row not found: ${where.id}`)
      Object.assign(row, data)
      return row
    },
  )
  mockDb.providerResumeToken.updateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) => {
      let count = 0
      for (const row of tokenStore.values()) {
        if (where.conversationId && row.conversationId !== where.conversationId) continue
        if (where.id && row.id !== where.id) continue
        if ('usedAt' in where && where.usedAt === null && row.usedAt !== null) continue
        if ('revokedAt' in where && where.revokedAt === null && row.revokedAt !== null) continue
        if (where.expiresAt && typeof where.expiresAt === 'object' && 'gt' in (where.expiresAt as Record<string, unknown>)) {
          const gt = (where.expiresAt as { gt: Date }).gt
          if (row.expiresAt.getTime() <= gt.getTime()) continue
        }
        Object.assign(row, data)
        count++
      }
      return { count }
    },
  )
  mockDb.providerResumeToken.findMany.mockImplementation(
    async ({ where }: { where: { conversationId: string } }) => {
      const results: TokenRow[] = []
      for (const row of tokenStore.values()) {
        if (where.conversationId && row.conversationId !== where.conversationId) continue
        results.push(row)
      }
      return results
    },
  )
  mockDb.providerResumeToken.deleteMany.mockImplementation(async () => {
    const count = tokenStore.size
    tokenStore.clear()
    return { count }
  })
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb))
})

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const BASE_ARGS = {
  conversationId: 'conv-1',
  phone: '+27000000001',
  issuedByAdminUserId: 'admin-1',
  source: 'recovery_nudge' as const,
}

describe('issueProviderResumeToken', () => {
  it('returns a raw token and stores only its hash', async () => {
    const { issueProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { rawToken, tokenId } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = tokenStore.get(tokenId)
    expect(row).not.toBeNull()
    expect(row!.tokenHash).toBe(hashProviderResumeToken(rawToken))
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + SEVEN_DAYS_MS - 60_000)
    // raw token must NOT appear anywhere in the stored row
    expect(JSON.stringify(row)).not.toContain(rawToken)
  })

  it('supersedes prior live tokens for the same conversation', async () => {
    const { issueProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const first = await issueProviderResumeToken(mockDb as never, BASE_ARGS)
    const second = await issueProviderResumeToken(mockDb as never, BASE_ARGS)

    const firstRow = tokenStore.get(first.tokenId)
    const secondRow = tokenStore.get(second.tokenId)
    expect(firstRow!.revokedAt).not.toBeNull()
    expect(firstRow!.revokedReason).toBe('superseded')
    expect(secondRow!.revokedAt).toBeNull()
  })
})

describe('validateProviderResumeToken', () => {
  it('returns ok for a fresh token', async () => {
    const { issueProviderResumeToken, validateProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { rawToken } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)
    const result = await validateProviderResumeToken(mockDb as never, rawToken)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.conversationId).toBe(BASE_ARGS.conversationId)
      expect(result.phone).toBe(BASE_ARGS.phone)
    }
  })

  it('rejects an unknown token', async () => {
    const { validateProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const result = await validateProviderResumeToken(mockDb as never, 'unknown-token-value-1234567890abcdef')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_found')
  })

  it('rejects an expired token', async () => {
    const { issueProviderResumeToken, validateProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { rawToken, tokenId } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)
    // manually expire
    tokenStore.get(tokenId)!.expiresAt = new Date(Date.now() - 1000)

    const result = await validateProviderResumeToken(mockDb as never, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('rejects a used token', async () => {
    const { issueProviderResumeToken, validateProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { rawToken, tokenId } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)
    tokenStore.get(tokenId)!.usedAt = new Date()

    const result = await validateProviderResumeToken(mockDb as never, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('used')
  })

  it('rejects a revoked token', async () => {
    const { issueProviderResumeToken, validateProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { rawToken, tokenId } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)
    tokenStore.get(tokenId)!.revokedAt = new Date()
    tokenStore.get(tokenId)!.revokedReason = 'admin_revoked'

    const result = await validateProviderResumeToken(mockDb as never, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('revoked')
  })
})

describe('consumeProviderResumeToken', () => {
  it('atomically marks the token used and returns true on first call', async () => {
    const { issueProviderResumeToken, consumeProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { tokenId } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)

    const consumed = await consumeProviderResumeToken(mockDb as never, tokenId)
    expect(consumed).toBe(true)
    expect(tokenStore.get(tokenId)!.usedAt).not.toBeNull()
  })

  it('returns false on second call (single-use)', async () => {
    const { issueProviderResumeToken, consumeProviderResumeToken } = await import('@/lib/provider-resume-tokens')
    const { tokenId } = await issueProviderResumeToken(mockDb as never, BASE_ARGS)

    await consumeProviderResumeToken(mockDb as never, tokenId)
    const second = await consumeProviderResumeToken(mockDb as never, tokenId)
    expect(second).toBe(false)
  })
})

describe('revokeProviderResumeTokensForConversation', () => {
  it('marks all live tokens for the conversation revoked', async () => {
    const { issueProviderResumeToken, revokeProviderResumeTokensForConversation } = await import('@/lib/provider-resume-tokens')
    await issueProviderResumeToken(mockDb as never, BASE_ARGS)

    const n = await revokeProviderResumeTokensForConversation(mockDb as never, BASE_ARGS.conversationId, 'admin_revoked')
    expect(n).toBe(1)

    const rows = Array.from(tokenStore.values()).filter(r => r.conversationId === BASE_ARGS.conversationId)
    expect(rows[0].revokedAt).not.toBeNull()
    expect(rows[0].revokedReason).toBe('admin_revoked')
  })
})
