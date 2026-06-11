import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

// ─── All mock references declared via vi.hoisted so they're available
//     inside vi.mock factory closures (vi.mock is hoisted to top of file) ─────
const {
  mockDb,
  mockSendText,
  mockSendButtons,
  mockSendList,
  mockSendCtaUrl,
  mockFindLatestActiveApp,
  mockCreateTestCohortContext,
} = vi.hoisted(() => {
  return {
    mockDb: {
      customer: { findFirst: vi.fn() },
      provider: { findFirst: vi.fn() },
      providerApplication: { create: vi.fn(), findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
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
  getPilotServiceCategories: vi.fn(() => [{ tag: 'plumbing', label: 'Plumbing' }]),
  RESTRICTED_SKILL_NOTICE: {},
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
describe('Registration cancel - summary step (reg_pending)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.auditLog.create.mockResolvedValue({})
  })

  it('does NOT create a ProviderApplication row on cancel (no PII persisted)', async () => {
    const result = await handleRegistrationFlow(makeCtx())
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('done')
  })

  it('writes a non-PII AuditLog cancellation event', async () => {
    await handleRegistrationFlow(makeCtx())
    expect(mockDb.auditLog.create).toHaveBeenCalledOnce()
    const auditCall = mockDb.auditLog.create.mock.calls[0][0]
    expect(auditCall.data.action).toBe('provider_application.cancelled')
    expect(auditCall.data.actorRole).toBe('provider_applicant')
    expect(auditCall.data.after.status).toBe('CANCELLED')
    // The event records only non-identifying counts/trace metadata - none of the
    // collected onboarding PII (name, ID/passport, email, evidence) is retained.
    const serialized = JSON.stringify(auditCall.data.after)
    expect(serialized).not.toContain('Sipho Dlamini')
    expect(serialized).not.toContain('8001010000088')
    expect(auditCall.data.after).not.toHaveProperty('name')
    expect(auditCall.data.after).not.toHaveProperty('idNumber')
    expect(auditCall.data.after).not.toHaveProperty('evidenceFileUrls')
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

  it('is non-fatal: still returns done and sends message even when the audit write fails', async () => {
    mockDb.auditLog.create.mockRejectedValueOnce(new Error('DB constraint'))
    const result = await handleRegistrationFlow(makeCtx())
    expect(result.nextStep).toBe('done')
    expect(mockSendText).toHaveBeenCalledOnce()
  })
})

describe('Registration cancel - intro (reg_cancel at name collection)', () => {
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
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
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
  // No CANCELLED ProviderApplication row is created, so a previously cancelled
  // applicant simply sees the onboarding intro screen and can re-apply.
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
