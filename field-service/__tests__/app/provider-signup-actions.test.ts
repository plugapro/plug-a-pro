import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGateEnabled, mockIssueLinkWebAction } = vi.hoisted(() => ({
  mockGateEnabled: vi.fn(async () => false),
  mockIssueLinkWebAction: vi.fn(async () => ({
    verificationId: 'ver-web-1',
    verificationUrl: 'https://verify.example.com/token',
    expiresAt: new Date(),
    reused: false,
  })),
}))

// Keep the quality gate OFF for all gate-OFF tests — Task 2.8 gate-ON tests use mockGateEnabled.mockResolvedValueOnce(true).
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: mockGateEnabled,
}))

vi.mock('@/lib/identity-verification/application-link', () => ({
  issueProviderApplicationVerificationLink: mockIssueLinkWebAction,
}))

// ─── In-memory stores (defined outside hoisted so tests can read them) ────────

const tokenStore = new Map<string, any>()
const conversationStore = new Map<string, any>()
const applicationStore: any[] = []
const featureFlagStore = new Map<string, any>()

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock() factories are hoisted to the top of the file by Vitest, so any
// variables they reference must themselves be hoisted via vi.hoisted().

const { mockDb, mockIsEnabled, mockRevalidatePath } = vi.hoisted(() => {
  const tokenStore = new Map<string, any>()
  const conversationStore = new Map<string, any>()
  const applicationStore: any[] = []

  const mockDb: any = {
    providerResumeToken: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.tokenHash) {
          for (const row of tokenStore.values()) if (row.tokenHash === where.tokenHash) return row
          return null
        }
        return tokenStore.get(where.id) ?? null
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0
        for (const row of tokenStore.values()) {
          if (where.id !== undefined && row.id !== where.id) continue
          if (where.conversationId !== undefined && row.conversationId !== where.conversationId) continue
          if (where.usedAt === null && row.usedAt !== null) continue
          if (where.revokedAt === null && row.revokedAt !== null) continue
          if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) continue
          Object.assign(row, data)
          count++
        }
        return { count }
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `tok-${tokenStore.size + 1}`,
          ...data,
          usedAt: data.usedAt ?? null,
          revokedAt: data.revokedAt ?? null,
          revokedReason: data.revokedReason ?? null,
        }
        tokenStore.set(row.id, row)
        return row
      }),
    },
    conversation: {
      findUnique: vi.fn(async ({ where }: any) => conversationStore.get(where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const c = conversationStore.get(where.id)
        if (!c) throw new Error('conversation not found')
        return c
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const c = conversationStore.get(where.id)
        if (!c) throw new Error('not found')
        Object.assign(c, data)
        return c
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0
        for (const c of conversationStore.values()) {
          if (where.phone && c.phone !== where.phone) continue
          if (where.flow && c.flow !== where.flow) continue
          Object.assign(c, data)
          count++
        }
        return { count }
      }),
    },
    customer: {
      findFirst: vi.fn(async () => null),
    },
    providerApplication: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const app of applicationStore) {
          if (where.phone && app.phone !== where.phone) continue
          if (where.status?.in && !where.status.in.includes(app.status)) continue
          return app
        }
        return null
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `app-${applicationStore.length + 1}`, ...data }
        applicationStore.push(row)
        return row
      }),
    },
    featureFlag: {
      findUnique: vi.fn(async () => null),
    },
    providerApplicationDraft: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'draft-web-1' })),
      update: vi.fn(async () => ({ id: 'draft-web-1' })),
    },
    $transaction: vi.fn(async (fn: any) => fn(mockDb)),
  }

  // Expose the stores so test-level code can read them back
  ;(mockDb as any).__tokenStore = tokenStore
  ;(mockDb as any).__conversationStore = conversationStore
  ;(mockDb as any).__applicationStore = applicationStore

  const mockIsEnabled = vi.fn(async (_key: string) => true)
  const mockRevalidatePath = vi.fn()

  return { mockDb, mockIsEnabled, mockRevalidatePath }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))


// ─── Convenience accessors for the hoisted stores ─────────────────────────────
// We cannot share references directly between hoisted and non-hoisted scope,
// so we attach them to mockDb and read them back here.

function getTokenStore(): Map<string, any> { return (mockDb as any).__tokenStore }
function getConversationStore(): Map<string, any> { return (mockDb as any).__conversationStore }
function getApplicationStore(): any[] { return (mockDb as any).__applicationStore }

// ─── Reset before each test ───────────────────────────────────────────────────

beforeEach(() => {
  getTokenStore().clear()
  getConversationStore().clear()
  getApplicationStore().splice(0)
  vi.clearAllMocks()

  // Restore default implementations after clearAllMocks
  mockIsEnabled.mockImplementation(async (_key: string) => true)

  mockDb.$transaction.mockImplementation(async (fn: any) => fn(mockDb))

  mockDb.providerResumeToken.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.tokenHash) {
      for (const row of getTokenStore().values()) if (row.tokenHash === where.tokenHash) return row
      return null
    }
    return getTokenStore().get(where.id) ?? null
  })

  mockDb.providerResumeToken.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0
    for (const row of getTokenStore().values()) {
      if (where.id !== undefined && row.id !== where.id) continue
      if (where.conversationId !== undefined && row.conversationId !== where.conversationId) continue
      if (where.usedAt === null && row.usedAt !== null) continue
      if (where.revokedAt === null && row.revokedAt !== null) continue
      if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) continue
      Object.assign(row, data)
      count++
    }
    return { count }
  })

  mockDb.providerResumeToken.create.mockImplementation(async ({ data }: any) => {
    const store = getTokenStore()
    const row = {
      id: `tok-${store.size + 1}`,
      ...data,
      usedAt: data.usedAt ?? null,
      revokedAt: data.revokedAt ?? null,
      revokedReason: data.revokedReason ?? null,
    }
    store.set(row.id, row)
    return row
  })

  mockDb.conversation.findUnique.mockImplementation(async ({ where }: any) =>
    getConversationStore().get(where.id) ?? null)

  mockDb.conversation.findUniqueOrThrow.mockImplementation(async ({ where }: any) => {
    const c = getConversationStore().get(where.id)
    if (!c) throw new Error('conversation not found')
    return c
  })

  mockDb.conversation.update.mockImplementation(async ({ where, data }: any) => {
    const c = getConversationStore().get(where.id)
    if (!c) throw new Error('not found')
    Object.assign(c, data)
    return c
  })

  mockDb.conversation.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0
    for (const c of getConversationStore().values()) {
      if (where.phone && c.phone !== where.phone) continue
      if (where.flow && c.flow !== where.flow) continue
      Object.assign(c, data)
      count++
    }
    return { count }
  })

  mockDb.providerApplication.findFirst.mockImplementation(async ({ where }: any) => {
    for (const app of getApplicationStore()) {
      if (where.phone && app.phone !== where.phone) continue
      if (where.status?.in && !where.status.in.includes(app.status)) continue
      return app
    }
    return null
  })

  mockDb.providerApplication.create.mockImplementation(async ({ data }: any) => {
    const store = getApplicationStore()
    const row = { id: `app-${store.length + 1}`, ...data }
    store.push(row)
    return row
  })

  mockGateEnabled.mockResolvedValue(false)
  mockIssueLinkWebAction.mockResolvedValue({
    verificationId: 'ver-web-1',
    verificationUrl: 'https://verify.example.com/token',
    expiresAt: new Date(),
    reused: false,
  })

  mockDb.providerApplicationDraft.findFirst.mockResolvedValue(null)
  mockDb.providerApplicationDraft.create.mockResolvedValue({ id: 'draft-web-1' })
  mockDb.providerApplicationDraft.update.mockResolvedValue({ id: 'draft-web-1' })

  mockDb.customer.findFirst.mockResolvedValue(null)
})

// ─── Import helpers and actions after mocks ───────────────────────────────────

import { issueProviderResumeToken } from '@/lib/provider-resume-tokens'
import { submitProviderApplicationFromWebAction, updateCapturedFieldAction } from '@/app/provider/signup/actions'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('submitProviderApplicationFromWebAction', () => {
  it('creates a ProviderApplication and marks the token used', async () => {
    const conv = {
      id: 'conv-1',
      phone: '+27000000020',
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: {
        name: 'Web User',
        idNumber: '8001015009087',
        skills: ['plumbing'],
        regionLabel: 'Sandton',
        cityLabel: 'Sandton',
        availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        hourlyRate: 350,
        profilePhotoUrl: 'https://blob/photo.jpg',
        bio: 'Plumber with five years of experience including big leaks.',
        references: 'Available on request from past clients on demand.',
        evidenceFileUrls: [],
      },
      expiresAt: new Date(Date.now() + 3600_000),
      updatedAt: new Date(),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken, tokenId } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    const result = await submitProviderApplicationFromWebAction({ rawToken, payload: {} })

    expect(result.ok).toBe(true)
    expect(getApplicationStore()).toHaveLength(1)
    expect(getApplicationStore()[0].status).toBe('PENDING')
    const updatedToken = getTokenStore().get(tokenId)
    expect(updatedToken.usedAt).not.toBeNull()

    // Verify Conversation.data now contains the user-submitted fields
    const updatedConv = getConversationStore().get(conv.id)
    expect(updatedConv.data).toEqual(expect.objectContaining({
      name: 'Web User', // pre-existing captured
      bio: expect.any(String), // also still there
    }))
  })

  it('rejects on token re-use', async () => {
    const conv = {
      id: 'conv-2',
      phone: '+27000000021',
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: {
        name: 'X',
        idNumber: '8001015009087',
        skills: ['plumbing'],
        regionLabel: 'X',
        cityLabel: 'X',
        availability: ['Mon'],
        hourlyRate: 100,
        profilePhotoUrl: 'https://blob/x',
        bio: 'b'.repeat(25),
        references: 'r'.repeat(15),
        evidenceFileUrls: [],
      },
      expiresAt: new Date(Date.now() + 3600_000),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    await submitProviderApplicationFromWebAction({ rawToken, payload: {} })
    await expect(submitProviderApplicationFromWebAction({ rawToken, payload: {} })).rejects.toThrow(/used/i)
  })

  it('rejects when the flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)

    await expect(
      submitProviderApplicationFromWebAction({ rawToken: 'x'.repeat(43), payload: {} }),
    ).rejects.toThrow(/disabled|feature/i)
  })

  it('persists user-submitted bio/references/profilePhotoUrl into Conversation.data', async () => {
    const conv = {
      id: 'conv-persist',
      phone: '+27000000040',
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: {
        name: 'Persist Test',
        idNumber: '8001015009087',
        skills: ['plumbing'],
        regionLabel: 'Sandton',
        cityLabel: 'Sandton',
        availability: ['Mon'],
        hourlyRate: 100,
        evidenceFileUrls: [],
        // bio, references, profilePhotoUrl intentionally absent — form must provide them
      },
      expiresAt: new Date(Date.now() + 3600_000),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    await submitProviderApplicationFromWebAction({
      rawToken,
      payload: {
        bio: 'I am an experienced plumber with five years of work history.',
        references: 'Available on request from past clients on demand.',
        profilePhotoUrl: 'https://blob.example.com/photo.jpg',
      },
    })

    const after = getConversationStore().get(conv.id)
    expect(after.data.bio).toBe('I am an experienced plumber with five years of work history.')
    expect(after.data.references).toBe('Available on request from past clients on demand.')
    expect(after.data.profilePhotoUrl).toBe('https://blob.example.com/photo.jpg')
  })
})

describe('updateCapturedFieldAction', () => {
  it('updates a single field in Conversation.data without burning the token', async () => {
    const conv = {
      id: 'conv-3',
      phone: '+27000000030',
      flow: 'registration',
      step: 'reg_collect_city',
      data: { name: 'Edit Me' },
      expiresAt: new Date(Date.now() + 3600_000),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    const result = await updateCapturedFieldAction({ rawToken, field: 'name', value: 'Edited Name' })
    expect(result.ok).toBe(true)
    expect(conv.data.name).toBe('Edited Name')

    // Token must NOT be consumed
    const tokens = Array.from(getTokenStore().values())
    expect(tokens[0].usedAt).toBeNull()
  })

  it('rejects fields not on the allowlist', async () => {
    const conv = {
      id: 'conv-evil',
      phone: '+27000000050',
      flow: 'registration',
      step: 'reg_collect_city',
      data: {},
      expiresAt: new Date(Date.now() + 3600_000),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    await expect(
      updateCapturedFieldAction({ rawToken, field: 'step', value: 'admin' }),
    ).rejects.toThrow(/field_not_allowed/i)
  })
})

describe('Task 2.8: Didit unavailable at submitProviderApplicationFromWebAction (gate ON)', () => {
  async function buildGateOnConvAndToken() {
    // All sections captured so selectMissingSections returns [] and schema validation passes.
    const conv = {
      id: `conv-gateon-${Date.now()}`,
      phone: '+27000000099',
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: {
        name: 'Gate On User',
        idNumber: '8001015009087',
        skills: ['plumbing'],
        regionLabel: 'Sandton',
        cityLabel: 'Sandton',
        availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        hourlyRate: 350,
        profilePhotoUrl: 'https://blob.example.com/photo.jpg',
        bio: 'I am an experienced plumber with five years of work history.',
        references: 'Available on request from past clients on demand.',
        evidenceFileUrls: [
          'https://blob.example.com/ev1.jpg',
          'https://blob.example.com/ev2.jpg',
          'https://blob.example.com/ev3.jpg',
        ],
        certificationRef: 'PIRB-12345',
      },
      expiresAt: new Date(Date.now() + 3600_000),
      updatedAt: new Date(),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    return { rawToken, conv }
  }

  it('issueLink throws generic Error → action returns awaitingVerification with null URL, does not throw', async () => {
    mockGateEnabled.mockResolvedValueOnce(true)
    mockIssueLinkWebAction.mockRejectedValueOnce(new Error('didit down'))

    const { rawToken } = await buildGateOnConvAndToken()
    const result = await submitProviderApplicationFromWebAction({ rawToken, payload: {} })

    expect(result).toMatchObject({ ok: true, awaitingVerification: true, verificationUrl: null })
    expect(getApplicationStore()).toHaveLength(0)
    expect(mockIssueLinkWebAction).toHaveBeenCalledTimes(1)
  })

  it('issueLink throws DiditDisabledError → same outcome, no application created', async () => {
    const { DiditDisabledError } = await import('@/lib/identity-verification/vendors/didit/client')
    mockGateEnabled.mockResolvedValueOnce(true)
    mockIssueLinkWebAction.mockRejectedValueOnce(new DiditDisabledError('DIDIT_API_KEY not set'))

    const { rawToken } = await buildGateOnConvAndToken()
    const result = await submitProviderApplicationFromWebAction({ rawToken, payload: {} })

    expect(result).toMatchObject({ ok: true, awaitingVerification: true, verificationUrl: null })
    expect(getApplicationStore()).toHaveLength(0)
  })
})

describe('P1: gate-ON conflict guards in PWA-B (submitProviderApplicationFromWebAction)', () => {
  async function buildGateOnConvAndTokenWithPhone(phone: string) {
    const conv = {
      id: `conv-p1-${Date.now()}-${Math.random()}`,
      phone,
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: {
        name: 'P1 Test User',
        idNumber: '8001015009087',
        skills: ['plumbing'],
        regionLabel: 'Sandton',
        cityLabel: 'Sandton',
        availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        hourlyRate: 350,
        profilePhotoUrl: 'https://blob.example.com/photo.jpg',
        bio: 'I am an experienced plumber with five years of work history.',
        references: 'Available on request from past clients on demand.',
        evidenceFileUrls: [
          'https://blob.example.com/ev1.jpg',
          'https://blob.example.com/ev2.jpg',
          'https://blob.example.com/ev3.jpg',
        ],
        certificationRef: 'PIRB-12345',
      },
      expiresAt: new Date(Date.now() + 3600_000),
      updatedAt: new Date(),
    }
    getConversationStore().set(conv.id, conv)

    const { rawToken } = await issueProviderResumeToken(mockDb as never, {
      conversationId: conv.id,
      phone: conv.phone,
      issuedByAdminUserId: 'admin-1',
      source: 'recovery_nudge',
    })

    return { rawToken, conv }
  }

  beforeEach(() => {
    mockGateEnabled.mockResolvedValue(true)
    mockIssueLinkWebAction.mockResolvedValue({
      verificationId: 'ver-web-2',
      verificationUrl: 'https://verify.example.com/token2',
      expiresAt: new Date(Date.now() + 3600_000),
      reused: false,
    })
  })

  it('gate ON + phone is a customer → throws PHONE_REGISTERED_AS_CUSTOMER, no draft, no KYC link', async () => {
    const phone = '+27821111101'
    mockDb.customer.findFirst.mockResolvedValueOnce({ id: 'cust-existing' })

    const { rawToken } = await buildGateOnConvAndTokenWithPhone(phone)

    await expect(
      submitProviderApplicationFromWebAction({ rawToken, payload: {} })
    ).rejects.toThrow(/PHONE_REGISTERED_AS_CUSTOMER/i)

    expect(getApplicationStore()).toHaveLength(0)
    expect(mockIssueLinkWebAction).not.toHaveBeenCalled()
  })

  it('gate ON + PENDING application exists → throws APPLICATION_CONFLICT:existing_pending, no new app, no KYC link', async () => {
    const phone = '+27821111102'
    // customer check returns null (default), seed PENDING application
    getApplicationStore().push({
      id: 'app-existing-pending',
      phone,
      status: 'PENDING',
      name: 'Existing',
    })

    const { rawToken } = await buildGateOnConvAndTokenWithPhone(phone)

    await expect(
      submitProviderApplicationFromWebAction({ rawToken, payload: {} })
    ).rejects.toThrow(/APPLICATION_CONFLICT.*existing_pending/i)

    // No new application was created — only the seeded one
    expect(getApplicationStore()).toHaveLength(1)
    expect(mockIssueLinkWebAction).not.toHaveBeenCalled()
  })

  it('gate ON + APPROVED application exists → throws APPLICATION_CONFLICT:existing_approved, no new app, no KYC link', async () => {
    const phone = '+27821111103'
    getApplicationStore().push({
      id: 'app-existing-approved',
      phone,
      status: 'APPROVED',
      name: 'Existing',
    })

    const { rawToken } = await buildGateOnConvAndTokenWithPhone(phone)

    await expect(
      submitProviderApplicationFromWebAction({ rawToken, payload: {} })
    ).rejects.toThrow(/APPLICATION_CONFLICT.*existing_approved/i)

    expect(getApplicationStore()).toHaveLength(1)
    expect(mockIssueLinkWebAction).not.toHaveBeenCalled()
  })

  it('gate ON + clean applicant → awaitingVerification, KYC link issued', async () => {
    const phone = '+27821111104'
    // customer.findFirst returns null (default), applicationStore is empty for this phone

    const { rawToken } = await buildGateOnConvAndTokenWithPhone(phone)
    const result = await submitProviderApplicationFromWebAction({ rawToken, payload: {} })

    expect(result).toMatchObject({ ok: true, awaitingVerification: true })
    expect(mockIssueLinkWebAction).toHaveBeenCalledTimes(1)
    expect(getApplicationStore()).toHaveLength(0)
  })
})
