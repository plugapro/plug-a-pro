import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

// ─── All mock references declared via vi.hoisted so they're available
//     inside vi.mock factory closures (vi.mock is hoisted to top of file) ─────
const {
  mockDb,
  mockTx,
  mockSendText,
  mockSendButtons,
  mockSendList,
  mockSendCtaUrl,
  mockFindLatestActiveApp,
  mockCreateTestCohortContext,
} = vi.hoisted(() => {
  const txObj = {
    providerApplication: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    customer: { findFirst: vi.fn() },
    provider: { findFirst: vi.fn() },
  }
  return {
    mockTx: txObj,
    mockDb: {
      customer: { findFirst: vi.fn() },
      provider: { findFirst: vi.fn() },
      providerApplication: { create: vi.fn(), findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txObj) => Promise<unknown>) => fn(txObj)),
    },
    mockSendText: vi.fn().mockResolvedValue(undefined),
    mockSendButtons: vi.fn().mockResolvedValue(undefined),
    mockSendList: vi.fn().mockResolvedValue(undefined),
    mockSendCtaUrl: vi.fn().mockResolvedValue(undefined),
    mockFindLatestActiveApp: vi.fn().mockResolvedValue(null),
    mockCreateTestCohortContext: vi.fn().mockReturnValue({ isTestUser: false, cohortName: null }),
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: mockSendButtons,
  sendList: mockSendList,
  sendCtaUrl: mockSendCtaUrl,
}))
vi.mock('@/lib/whatsapp-copy', () => ({
  WHATSAPP_COPY: {},
  ctaLabelFor: vi.fn().mockReturnValue('View Terms'),
}))
vi.mock('@/lib/provider-credit-copy', () => ({
  PROVIDER_APPLY_BUTTON_TITLE: 'Apply Now',
  PROVIDER_NOT_NOW_BUTTON_TITLE: 'Not Now',
  buildProviderApplicationSubmittedMessage: vi.fn().mockReturnValue('Submitted!'),
  buildProviderOnboardingIntroMessage: vi.fn().mockReturnValue('Welcome!'),
  getProviderTermsUrl: vi.fn().mockReturnValue('https://plugapro.co.za/terms'),
}))
vi.mock('@/lib/provider-applications', () => ({
  findLatestActiveProviderApplicationByPhone: mockFindLatestActiveApp,
}))
vi.mock('@/lib/internal-test-cohort', () => ({
  createTestCohortContext: mockCreateTestCohortContext,
}))
vi.mock('@/lib/location-format', () => ({
  normaliseLocationDisplayName: vi.fn((x: string) => x),
  normaliseLocationDisplayNames: vi.fn((x: string[]) => x),
}))
vi.mock('@/lib/provider-onboarding-data', () => ({
  formatRandAmountForProviderOnboarding: vi.fn((n: number) => `R${n}`),
  validateProviderOnboardingRates: vi.fn(),
  ProviderOnboardingValidationError: class extends Error {},
}))
vi.mock('@/lib/service-categories', () => ({
  SERVICE_CATEGORY_OPTIONS: [{ tag: 'plumbing', label: 'Plumbing' }],
  resolveServiceCategoryTag: vi.fn((s: string) => (s === 'Plumbing' ? 'plumbing' : null)),
}))
vi.mock('@/lib/service-area-guard', () => ({
  ACTIVE_PILOT_CITY_LABEL: 'Johannesburg',
  ACTIVE_PILOT_REGION_LABEL: 'JHB North',
  describeCityServiceStatus: vi.fn().mockReturnValue(''),
  describeRegionServiceStatus: vi.fn().mockReturnValue(''),
  getRegionServiceStatus: vi.fn().mockReturnValue({ available: true }),
}))
vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn(),
}))
vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: vi.fn(),
  upsertStructuredServiceAreas: vi.fn(),
}))
vi.mock('@/lib/provider-skills', () => ({
  syncProviderSkills: vi.fn(),
}))
vi.mock('@/lib/matching/customer-recontact', () => ({
  checkJobsForNewProviderAvailability: vi.fn(),
}))
vi.mock('@/lib/whatsapp-identity', () => ({
  phoneLookupVariants: (phone: string) => [phone],
}))

// ─── Subject (imported after mocks) ──────────────────────────────────────────
import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    phone: '+27821234567',
    step: 'reg_pending',
    flow: 'registration',
    data: {
      name: 'Sipho Dlamini',
      skills: ['Plumbing'],
      serviceAreas: ['Soweto'],
      selectedSuburbLabels: ['Soweto'],
      selectedRegionLabels: [],
      locationNodeIds: [],
      availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      experience: '3–5 years',
      callOutFee: 300,
      providerIdNumber: '8001010000088',
      evidenceFileUrls: [],
    },
    reply: { type: 'button_reply', id: 'submit_no', title: '❌ Cancel' },
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Registration cancel — summary step (reg_pending)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.providerApplication.create.mockResolvedValue({ id: 'app_cancelled_123' })
    mockTx.auditLog.create.mockResolvedValue({})
  })

  it('creates a CANCELLED ProviderApplication record', async () => {
    const result = await handleRegistrationFlow(makeCtx())
    expect(mockTx.providerApplication.create).toHaveBeenCalledOnce()
    const createCall = mockTx.providerApplication.create.mock.calls[0][0]
    expect(createCall.data.status).toBe('CANCELLED')
    expect(createCall.data.cancelledAt).toBeInstanceOf(Date)
    expect(createCall.data.name).toBe('Sipho Dlamini')
    expect(createCall.data.skills).toEqual(['Plumbing'])
    expect(result.nextStep).toBe('done')
  })

  it('writes an AuditLog entry inside the same transaction', async () => {
    await handleRegistrationFlow(makeCtx())
    expect(mockTx.auditLog.create).toHaveBeenCalledOnce()
    const auditCall = mockTx.auditLog.create.mock.calls[0][0]
    expect(auditCall.data.action).toBe('provider_application.cancelled')
    expect(auditCall.data.actorRole).toBe('provider_applicant')
    expect(auditCall.data.after.status).toBe('CANCELLED')
  })

  it('sends the cancellation message without a trailing emoji', async () => {
    await handleRegistrationFlow(makeCtx())
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      'Application cancelled. Reply *join* anytime to apply again.',
    )
  })

  it('returns nextStep: done', async () => {
    const result = await handleRegistrationFlow(makeCtx())
    expect(result.nextStep).toBe('done')
  })

  it('is non-fatal: still returns done and sends message even when DB write fails', async () => {
    mockDb.$transaction.mockRejectedValueOnce(new Error('DB constraint'))
    const result = await handleRegistrationFlow(makeCtx())
    expect(result.nextStep).toBe('done')
    expect(mockSendText).toHaveBeenCalledOnce()
  })

  it('uses selectedSuburbLabels as the service area list', async () => {
    const ctx = makeCtx({
      data: {
        ...makeCtx().data,
        selectedSuburbLabels: ['Soweto', 'Diepkloof'],
        selectedRegionLabels: [],
        serviceAreas: [],
      },
    })
    await handleRegistrationFlow(ctx)
    const createCall = mockTx.providerApplication.create.mock.calls[0][0]
    expect(createCall.data.serviceAreas).toContain('Soweto')
    expect(createCall.data.serviceAreas).toContain('Diepkloof')
  })
})

describe('Registration cancel — intro (reg_cancel at name collection)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT write any DB record when cancelled at intro', async () => {
    const ctx = makeCtx({
      step: 'reg_collect_name',
      data: {},
      reply: { type: 'button_reply', id: 'reg_cancel', title: 'Not Now' },
    })
    await handleRegistrationFlow(ctx)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
    expect(mockTx.providerApplication.create).not.toHaveBeenCalled()
  })

  it('sends the no-problem message without trailing emoji', async () => {
    const ctx = makeCtx({
      step: 'reg_collect_name',
      data: {},
      reply: { type: 'button_reply', id: 'reg_cancel', title: 'Not Now' },
    })
    await handleRegistrationFlow(ctx)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      "No problem! Reply *join* anytime when you're ready to apply.",
    )
  })

  it('returns nextStep: done', async () => {
    const ctx = makeCtx({
      step: 'reg_collect_name',
      data: {},
      reply: { type: 'button_reply', id: 'reg_cancel', title: 'Not Now' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('done')
  })
})

describe('Re-join after cancel', () => {
  // CANCELLED is excluded from ACTIVE_PROVIDER_APPLICATION_STATUSES, so
  // findLatestActiveProviderApplicationByPhone returns null — the provider
  // sees the onboarding intro screen and can re-apply.
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.provider.findFirst.mockResolvedValue(null)
    mockDb.customer.findFirst.mockResolvedValue(null)
    mockFindLatestActiveApp.mockResolvedValue(null)
  })

  it('shows the intro screen when a previously cancelled provider triggers join', async () => {
    const ctx = makeCtx({
      step: 'reg_start',
      flow: 'registration',
      data: {},
      reply: { type: 'text', id: undefined, title: '', text: 'join' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_name')
    expect(mockSendButtons).toHaveBeenCalled()
  })
})
