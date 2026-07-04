import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockIsQualityGateV2Enabled, mockIssueLink } = vi.hoisted(() => {
  return {
    mockIsQualityGateV2Enabled: vi.fn(async () => false),
    mockIssueLink: vi.fn(async () => ({
      verificationId: 'ver-1',
      verificationUrl: 'https://verify.example.com/token',
      expiresAt: new Date(),
      reused: false,
    })),
  }
})

vi.mock('@/lib/provider-onboarding/quality-gate', () => ({
  isQualityGateV2Enabled: mockIsQualityGateV2Enabled,
  evaluateEvidenceGate: vi.fn(() => ({ ok: true, have: 3, need: 3 })),
  evaluateCertificationGate: vi.fn(() => ({ required: false, ok: true })),
}))

vi.mock('@/lib/identity-verification/application-link', () => ({
  issueProviderApplicationVerificationLink: mockIssueLink,
}))

// ─── In-memory stores ─────────────────────────────────────────────────────────
const draftStore = new Map<string, any>()
const tokenStore = new Map<string, any>()
const customerStore: any[] = []
const applicationStore: any[] = []

function buildSuburbRow() {
  return {
    id: 'sub_sandton',
    nodeType: 'SUBURB',
    slug: 'gauteng__johannesburg__sandton__sandton_city',
    label: 'Sandton City',
    postalCode: '2196',
    provinceKey: 'gauteng',
    cityKey: 'johannesburg',
    regionKey: 'sandton',
    parent: {
      id: 'region-sandton',
      nodeType: 'REGION',
      label: 'Sandton',
      parent: {
        id: 'city-johannesburg',
        nodeType: 'CITY',
        label: 'Johannesburg',
        parent: {
          id: 'province-gauteng',
          nodeType: 'PROVINCE',
          label: 'Gauteng',
        },
      },
    },
  }
}

function buildMockClient() {
  return {
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    locationNode: {
      findMany: vi.fn(async () => [buildSuburbRow()]),
    },
    providerApplicationDraft: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const d of draftStore.values()) {
          if (d.id === where.id) return d
          if (where.submittedApplicationId === null && !d.submittedApplicationId && d.phone === where.phone) return d
        }
        return null
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `draft-${draftStore.size + 1}`, ...data }
        draftStore.set(row.id, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = draftStore.get(where.id)
        if (row) Object.assign(row, data)
        return row ?? { id: where.id, ...data }
      }),
    },
    registrationResumeToken: {
      findUnique: vi.fn(async ({ where }: any) => {
        for (const t of tokenStore.values()) {
          if (t.tokenHash === where.tokenHash) return t
        }
        return null
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    customer: {
      findFirst: vi.fn(async () => null),
    },
    providerApplication: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `app-${applicationStore.length + 1}`, ...data }
        applicationStore.push(row)
        return row
      }),
    },
  }
}

let tx: ReturnType<typeof buildMockClient>
let mockClient: ReturnType<typeof buildMockClient>

// ─── Additional mocks ─────────────────────────────────────────────────────────
vi.mock('@/lib/phone-normalization', () => ({
  normalizeOtpPhoneNumber: vi.fn((phone: string) => ({ ok: true, e164: phone, errorCode: '', reason: '' })),
}))
vi.mock('@/lib/provider-applications', () => ({
  findLatestActiveProviderApplicationByPhone: vi.fn(async () => null),
  normalizeProviderApplicationPhone: vi.fn((p: string) => p),
}))
const { mockSyncProviderRecord } = vi.hoisted(() => ({
  mockSyncProviderRecord: vi.fn(async () => 'provider-1'),
}))

vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: mockSyncProviderRecord,
  upsertStructuredServiceAreas: vi.fn(async () => {}),
}))
vi.mock('@/lib/service-categories', () => ({
  normalizeServiceCategorySelections: vi.fn((s: string[]) => s),
  resolveServiceCategoryTag: vi.fn((s: string) => s),
}))
vi.mock('@/lib/internal-test-cohort', () => ({
  createTestCohortContext: vi.fn(() => ({ isTestUser: false, cohortName: null })),
}))
vi.mock('@/lib/provider-onboarding-completeness', () => ({
  evaluateProviderProfileCompleteness: vi.fn(() => ({ canSubmit: true })),
}))
vi.mock('@/lib/location-format', () => ({
  normaliseLocationDisplayName: vi.fn((s: string) => s),
  normaliseLocationDisplayNames: vi.fn((s: string[]) => s),
}))
vi.mock('@/lib/provider-registration/tokens', () => ({
  hashRegistrationResumeToken: vi.fn(async (t: string) => `hash-${t}`),
}))

import { submitProviderRegistrationApplication } from '@/lib/provider-registration/pwa-flow'

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function buildValidInput() {
  // Create a draft and token in the store
  const draftId = `draft-${draftStore.size + 1}`
  draftStore.set(draftId, { id: draftId, phone: '+27000000001', submittedApplicationId: null })

  const rawToken = 'myresumetoken'
  const tokenHash = `hash-${rawToken}`
  tokenStore.set(tokenHash, {
    tokenHash,
    draftId,
    purpose: 'provider_registration_resume',
    expiresAt: new Date(Date.now() + 3_600_000),
    consumedAt: null,
    draft: { id: draftId, phone: '+27000000001' },
  })

  return {
    draftId,
    resumeToken: rawToken,
    phone: '+27000000001',
    name: 'Test Provider',
    consentAccepted: true,
    skills: ['plumbing'],
    serviceAreas: ['Sandton City'],
    locationNodeIds: ['sub_sandton'],
    provinceId: 'province-gauteng',
    cityId: 'city-johannesburg',
    regionId: 'region-sandton',
    experience: '1-3',
    availability: 'Mon, Tue',
    availabilityDays: ['Mon', 'Tue'],
    callOutFee: 150,
    evidenceFileUrls: ['https://a.vercel-storage.com/1.jpg', 'https://a.vercel-storage.com/2.jpg', 'https://a.vercel-storage.com/3.jpg'],
    certificationRef: null,
  }
}

beforeEach(() => {
  draftStore.clear()
  tokenStore.clear()
  customerStore.splice(0)
  applicationStore.splice(0)
  vi.clearAllMocks()

  tx = buildMockClient()
  mockClient = buildMockClient()
  mockClient.$transaction.mockImplementation(async (fn: any) => fn(tx))

  mockIsQualityGateV2Enabled.mockResolvedValue(false)
  mockIssueLink.mockResolvedValue({
    verificationId: 'ver-1',
    verificationUrl: 'https://verify.example.com/token',
    expiresAt: new Date(),
    reused: false,
  })
})

describe('submitProviderRegistrationApplication — gate OFF', () => {
  it('creates application (existing gate-OFF path)', async () => {
    const input = await buildValidInput()
    const result = await submitProviderRegistrationApplication(mockClient as never, input as any)
    expect(result.outcome).toBe('created')
    expect(applicationStore).toHaveLength(1)
    expect(mockIssueLink).not.toHaveBeenCalled()
  })
})

describe('submitProviderRegistrationApplication — gate ON', () => {
  beforeEach(() => {
    mockIsQualityGateV2Enabled.mockResolvedValue(true)
  })

  it('returns awaiting_verification with a verificationUrl', async () => {
    const input = await buildValidInput()
    const result = await submitProviderRegistrationApplication(mockClient as never, input as any)
    expect(result.outcome).toBe('awaiting_verification')
    expect((result as any).verificationUrl).toBe('https://verify.example.com/token')
  })

  it('writes submitPayload with channel PWA_SELF_SERVE onto the draft', async () => {
    const input = await buildValidInput()
    await submitProviderRegistrationApplication(mockClient as never, input as any)

    // The draft.update should have been called with submitPayload
    const updateCalls = tx.providerApplicationDraft.update.mock.calls
    expect(updateCalls.length).toBeGreaterThan(0)
    const payload = updateCalls[0][0].data.submitPayload
    expect(payload).toBeDefined()
    expect(payload.channel).toBe('PWA_SELF_SERVE')
    expect(payload.version).toBe(1)
  })

  it('does NOT create a ProviderApplication', async () => {
    const input = await buildValidInput()
    await submitProviderRegistrationApplication(mockClient as never, input as any)
    expect(applicationStore).toHaveLength(0)
  })

  it('does NOT consume the resume token', async () => {
    const input = await buildValidInput()
    await submitProviderRegistrationApplication(mockClient as never, input as any)
    // updateMany on registrationResumeToken (consume) should not be called
    expect(tx.registrationResumeToken.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consumedAt: expect.any(Date) }) })
    )
  })

  it('calls issueProviderApplicationVerificationLink with channel PWA', async () => {
    const input = await buildValidInput()
    await submitProviderRegistrationApplication(mockClient as never, input as any)
    expect(mockIssueLink).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'PWA' }),
    )
  })
})

describe('Task 2.8: Didit unavailable at submitProviderRegistrationApplication (gate ON)', () => {
  beforeEach(() => {
    mockIsQualityGateV2Enabled.mockResolvedValue(true)
  })

  it('issueLink throws generic Error → returns awaiting_verification with verificationUrl null, no application created', async () => {
    mockIssueLink.mockRejectedValueOnce(new Error('didit down'))
    const input = await buildValidInput()
    const result = await submitProviderRegistrationApplication(mockClient as never, input as any)

    expect(result.outcome).toBe('awaiting_verification')
    expect((result as any).verificationUrl).toBeNull()
    expect(applicationStore).toHaveLength(0)
    expect(mockIssueLink).toHaveBeenCalledTimes(1)
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
  })

  it('issueLink throws DiditDisabledError → same awaiting_verification outcome, no application', async () => {
    const { DiditDisabledError } = await import('@/lib/identity-verification/vendors/didit/client')
    mockIssueLink.mockRejectedValueOnce(new DiditDisabledError('DIDIT_API_KEY not set'))
    const input = await buildValidInput()
    const result = await submitProviderRegistrationApplication(mockClient as never, input as any)

    expect(result.outcome).toBe('awaiting_verification')
    expect((result as any).verificationUrl).toBeNull()
    expect(applicationStore).toHaveLength(0)
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
  })
})
