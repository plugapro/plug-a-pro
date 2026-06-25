// Tier 1 funnel observability — verifies PROVIDER_NOTIFIED is emitted once per
// dispatch attempt with the correct delivered=true/false boolean.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// This file imports the production `dispatchMatchLead` function from
// `lib/matching/dispatch.ts` and mocks the external seams so CI will catch any
// drift in the emit-decision logic or metadata keys.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock handles ───────────────────────────────────────────────────────
// vi.hoisted() runs before module resolution so these refs are safe to use
// inside vi.mock() factory functions.
const mocks = vi.hoisted(() => {
  const recordWorkflowEvent = vi.fn(async (_input: Record<string, unknown>) => ({ id: 'we_test', occurredAt: new Date() }))
  const sendJobOffer = vi.fn(async (..._args: unknown[]) => ({ messageId: 'msg_ok' }) as unknown)
  const sendButtons = vi.fn(async (..._args: unknown[]) => ({}) as unknown)
  const hasSuccessfulMessageForRecipient = vi.fn(async (..._args: unknown[]) => false)
  const getProviderLeadAccessUrl = vi.fn(async (..._args: unknown[]): Promise<string | null> => 'https://plugapro.co.za/lead/lead_test?t=tok')
  const messageEventCreate = vi.fn(async (..._args: unknown[]) => ({}) as unknown)
  const leadUpsert = vi.fn(async (..._args: unknown[]) => ({ id: 'lead_test', isTestLead: false, cohortName: null }))
  const attachmentCount = vi.fn(async (..._args: unknown[]) => 0)
  const leadFindUnique = vi.fn(async (..._args: unknown[]): Promise<{ id: string; status: string } | null> => null)
  const canSend = vi.fn(async (..._args: unknown[]): Promise<{ allowed: boolean; reason?: string | undefined }> => ({ allowed: true, reason: undefined }))
  return {
    recordWorkflowEvent,
    sendJobOffer,
    sendButtons,
    hasSuccessfulMessageForRecipient,
    getProviderLeadAccessUrl,
    messageEventCreate,
    leadUpsert,
    attachmentCount,
    leadFindUnique,
    canSend,
  }
})

vi.mock('../../../lib/workflow-events/record', () => ({
  recordWorkflowEvent: mocks.recordWorkflowEvent,
}))

vi.mock('../../../lib/whatsapp', () => ({
  sendJobOffer: mocks.sendJobOffer,
  sendText: vi.fn(async () => ({})),
}))

vi.mock('../../../lib/whatsapp-interactive', () => ({
  sendButtons: mocks.sendButtons,
}))

vi.mock('../../../lib/message-events', () => ({
  hasSuccessfulMessageForRecipient: mocks.hasSuccessfulMessageForRecipient,
}))

vi.mock('../../../lib/provider-lead-access', () => ({
  getProviderLeadAccessUrl: mocks.getProviderLeadAccessUrl,
}))

vi.mock('../../../lib/provider-wallet', () => ({
  getProviderWalletBalanceReadOnly: vi.fn(async () => 0),
}))

vi.mock('../../../lib/provider-wallet-notifications', () => ({
  notifyProviderZeroBalanceLeadAvailable: vi.fn(async () => {}),
}))

vi.mock('../../../lib/location-format', () => ({
  normaliseLocationDisplayName: vi.fn((v: string | null | undefined) => v ?? ''),
}))

vi.mock('../../../lib/support-diagnostics', () => ({
  maskPhone: vi.fn((p: string) => p.slice(0, 3) + '****'),
}))

vi.mock('../../../lib/provider-credit-copy', () => ({
  buildProviderLeadPreviewMessage: vi.fn(() => 'preview body'),
  buildProviderLeadActionsMessage: vi.fn(() => 'actions body'),
}))

vi.mock('../../../lib/whatsapp-policy', () => ({
  canSend: mocks.canSend,
}))

vi.mock('../../../lib/flags', () => ({
  isEnabled: vi.fn(async () => false),
}))

// quick_match_provider_lead_offer is MARKETING so the canSend policy check fires.
vi.mock('../../../lib/messaging-templates', () => ({
  TEMPLATES: {
    quick_match_provider_lead_offer: { category: 'MARKETING' },
    provider_lead_offer: { category: 'UTILITY' },
  },
}))

vi.mock('../../../lib/matching/config', () => ({
  MATCHING_CONFIG: { offerTtlMinutes: 15 },
}))

vi.mock('../../../lib/db', () => ({
  db: {
    lead: { upsert: mocks.leadUpsert, findUnique: mocks.leadFindUnique },
    messageEvent: { create: mocks.messageEventCreate },
    attachment: { count: mocks.attachmentCount },
    provider: { findUnique: vi.fn(async () => null) },
  },
}))

// ── Import production module ───────────────────────────────────────────────────
import { dispatchMatchLead } from '../../../lib/matching/dispatch'

// ── Test fixtures ──────────────────────────────────────────────────────────────
const BASE_JOB_REQUEST = {
  id: 'jr_test',
  category: 'plumbing',
  title: 'Burst pipe',
  description: 'Kitchen burst pipe',
  assignmentMode: 'AUTO_ASSIGN' as const,
  isTestRequest: false,
  cohortName: null,
  requestedWindowStart: null,
  requestedWindowEnd: null,
  requestedArrivalLatest: null,
  estimatedDurationMinutes: null,
  requiredSkillTags: [],
  requiredCertificationCodes: [],
  requiredEquipmentTags: [],
  requiredVehicleTypes: [],
  preferredProviderId: null,
  customerAcceptedAmount: null,
  customerAcceptedScope: null,
  autoCreateBookingOnAssignment: false,
  subcategory: null,
  urgency: null,
  providerPreference: null,
  budgetPreference: null,
  address: { suburb: 'Roodepoort' },
  customer: { id: 'cust_1', name: 'Alice', phone: '+27820000001' },
  status: 'OPEN' as const,
  expiresAt: null,
  selectedProviderId: null,
  selectedLeadInviteId: null,
}

const BASE_PROVIDER = {
  id: 'prov_test',
  name: 'Bob Plumber',
  phone: '+27820000002',
  isTestUser: false,
  skills: ['plumbing'],
  serviceAreas: [] as string[],
  maxTravelMinutes: 60,
  averageRating: 4.5,
  reliabilityScore: 0.9,
  availableNow: true,
  active: true,
  verified: true,
  kycStatus: 'VERIFIED' as string | null,
  lastKnownLat: null,
  lastKnownLng: null,
  isOnline: null,
  liveLocationLat: null,
  liveLocationLng: null,
  lastHeartbeatAt: null,
  scoreBase: 0.9,
  fromPool: true,
}

const BASE_HOLD = {
  id: 'hold_test',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  dispatchDecisionId: 'dd_test',
  matchAttemptId: 'ma_test',
}

describe('dispatch PROVIDER_NOTIFIED emit — production module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to safe defaults after clearAllMocks
    mocks.leadFindUnique.mockResolvedValue(null)
    mocks.leadUpsert.mockResolvedValue({ id: 'lead_test', isTestLead: false, cohortName: null })
    mocks.attachmentCount.mockResolvedValue(0)
    mocks.sendJobOffer.mockResolvedValue({ messageId: 'msg_ok' })
    mocks.sendButtons.mockResolvedValue({})
    mocks.hasSuccessfulMessageForRecipient.mockResolvedValue(false)
    mocks.getProviderLeadAccessUrl.mockResolvedValue('https://plugapro.co.za/lead/lead_test?t=tok')
    mocks.canSend.mockResolvedValue({ allowed: true, reason: undefined })
    mocks.recordWorkflowEvent.mockResolvedValue({ id: 'we_test', occurredAt: new Date() })
    mocks.messageEventCreate.mockResolvedValue({})
  })

  it('emits PROVIDER_NOTIFIED with delivered=true when sendJobOffer succeeds', async () => {
    await dispatchMatchLead({
      jobRequest: BASE_JOB_REQUEST,
      hold: BASE_HOLD,
      provider: BASE_PROVIDER,
    })

    expect(mocks.recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const call = mocks.recordWorkflowEvent.mock.calls[0]![0]!
    expect(call.eventType).toBe('PROVIDER_NOTIFIED')
    expect(call.entityType).toBe('LEAD')
    expect(call.entityId).toBe('lead_test')
    const meta = call.metadata as Record<string, unknown>
    expect(meta.delivered).toBe(true)
    expect(meta.failureReason).toBeUndefined()
    expect(meta.providerId).toBe('prov_test')
    expect(meta.jobRequestId).toBe('jr_test')
    expect(meta.channel).toBe('WHATSAPP')
  })

  it('emits PROVIDER_NOTIFIED with delivered=false when sendJobOffer throws', async () => {
    mocks.sendJobOffer.mockRejectedValueOnce(new Error('Template not approved'))

    await dispatchMatchLead({
      jobRequest: BASE_JOB_REQUEST,
      hold: BASE_HOLD,
      provider: BASE_PROVIDER,
    })

    expect(mocks.recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const call = mocks.recordWorkflowEvent.mock.calls[0]![0]!
    expect(call.eventType).toBe('PROVIDER_NOTIFIED')
    const meta = call.metadata as Record<string, unknown>
    expect(meta.delivered).toBe(false)
    expect(meta.failureReason).toBe('Template not approved')
  })

  it('emits PROVIDER_NOTIFIED with delivered=false and creates messageEvent with providerId+leadId when leadUrl is missing', async () => {
    mocks.getProviderLeadAccessUrl.mockResolvedValueOnce(null)

    await dispatchMatchLead({
      jobRequest: BASE_JOB_REQUEST,
      hold: BASE_HOLD,
      provider: BASE_PROVIDER,
    })

    expect(mocks.recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const meta = mocks.recordWorkflowEvent.mock.calls[0]![0]!.metadata as Record<string, unknown>
    expect(meta.delivered).toBe(false)
    expect(meta.failureReason).toBe('Missing provider lead access URL')

    // MessageEvent.providerId + MessageEvent.leadId must both be set on the failure path
    expect(mocks.messageEventCreate).toHaveBeenCalledTimes(1)
    const createArg = (mocks.messageEventCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(createArg.providerId).toBe('prov_test')
    expect(createArg.leadId).toBe('lead_test')
    expect(createArg.status).toBe('FAILED')
  })

  it('does NOT emit when ctaAlreadySent (retry — template already sent)', async () => {
    // First call: ctaAlreadySent = true; second call: actionsAlreadySent = false
    mocks.hasSuccessfulMessageForRecipient
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await dispatchMatchLead({
      jobRequest: BASE_JOB_REQUEST,
      hold: BASE_HOLD,
      provider: BASE_PROVIDER,
    })

    expect(mocks.recordWorkflowEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit when the provider previously declined (early return)', async () => {
    mocks.leadFindUnique.mockResolvedValueOnce({ id: 'lead_test', status: 'DECLINED' })

    await dispatchMatchLead({
      jobRequest: BASE_JOB_REQUEST,
      hold: BASE_HOLD,
      provider: BASE_PROVIDER,
    })

    expect(mocks.recordWorkflowEvent).not.toHaveBeenCalled()
  })
})
