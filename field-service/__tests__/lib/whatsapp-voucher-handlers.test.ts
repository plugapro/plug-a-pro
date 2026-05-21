import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock all external dependencies before importing the module under test ──────

vi.mock('@/lib/db', () => {
  const providerMock = { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() }
  const availabilityMock = { upsert: vi.fn().mockResolvedValue({}) }
  const txClient = { provider: providerMock, technicianAvailability: availabilityMock }
  return {
    db: {
      provider: providerMock,
      providerApplication: { findFirst: vi.fn() },
      technicianAvailability: availabilityMock,
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      lead: { findMany: vi.fn(), findUnique: vi.fn() },
      job: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    },
  }
})

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/voucher-redemption', () => ({
  redeemVoucher: vi.fn(),
}))

vi.mock('@/lib/vouchers', () => ({
  mapVoucherRedemptionErrorToMessage: vi.fn((code: string) => `Error: ${code}`),
  generateVoucherCode: vi.fn(),
  normalizeVoucherCode: vi.fn(),
  voucherCodeToHash: vi.fn(),
  VOUCHER_CODE_REGEX: /^PAP-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
}))

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/jobs', () => ({
  transitionJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  promptCustomersForNewProviderAvailability: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-lead-access', () => ({
  getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/provider/jobs/job-request-1/handover?token=token'),
}))

vi.mock('@/lib/provider-credit-payment-intents', () => ({
  createPayatTopUpIntent: vi.fn(),
}))

vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentIntentCreated: vi.fn().mockResolvedValue(undefined),
  notifyProviderPaymentCredited: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-wallet', () => ({
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5_000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5_000,
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue({
    providerId: 'prov_1',
    paidCreditBalance: 2,
    promoCreditBalance: 3,
    totalCreditBalance: 5,
    status: 'ACTIVE',
  }),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendCustomerRunningLateNotification: vi.fn().mockResolvedValue(undefined),
  sendProviderInvoiceTemplate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/audit-entities', () => ({
  AUDIT_ENTITY: {
    PROVIDER: 'PROVIDER',
    JOB_REQUEST: 'JOB_REQUEST',
    BOOKING: 'BOOKING',
  },
}))

vi.mock('@/lib/provider-credit-copy', () => ({
  buildProviderCreditSummaryMessage: vi.fn().mockReturnValue('Credit summary'),
  creditCountLabel: vi.fn((n: number) => `${n} credits`),
  getPublicAppUrl: vi.fn().mockReturnValue('https://app.plugapro.co.za'),
  providerCreditBreakdownLabel: vi.fn().mockReturnValue('Starter: 3 · Purchased: 2'),
}))

vi.mock('@/lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn().mockReturnValue('Open'),
}))

vi.mock('@/lib/location-format', () => ({
  normaliseLocationDisplayName: vi.fn((s: string) => s),
}))

vi.mock('@/lib/whatsapp-identity', () => ({
  phoneLookupVariants: vi.fn(() => []),
}))

// ── Imports (must come after vi.mock calls) ───────────────────────────────────

import { handleProviderJourneyFlow } from '@/lib/whatsapp-flows/provider-journey'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'
import * as voucherRedemption from '@/lib/voucher-redemption'
import * as vouchers from '@/lib/vouchers'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PHONE = '+27711111111'

function makeCtx(step: string, replyText?: string) {
  return {
    phone: PHONE,
    step: step as any,
    data: {} as any,
    flow: 'provider_journey' as const,
    reply: {
      type: 'text' as const,
      id: undefined,
      text: replyText,
      title: undefined,
    },
  }
}

function makeActiveProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov_1',
    name: 'Sipho',
    phone: PHONE,
    active: true,
    status: 'ACTIVE',
    availableNow: true,
    suspendedUntil: null,
    technicianAvailability: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WhatsApp voucher redemption handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: provider lookup returns null (overridden per-test as needed)
    ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;((db as any).provider.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;((db as any).providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    // Default: mapVoucherRedemptionErrorToMessage returns a predictable string
    ;(vouchers.mapVoucherRedemptionErrorToMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (code: string) => `Error: ${code}`,
    )
  })

  // ── handleVoucherRedeemPrompt ─────────────────────────────────────────────

  describe('pj_redeem_voucher step (handleVoucherRedeemPrompt)', () => {
    it('provider not found → sends not-registered message → returns done', async () => {
      // db.provider.findUnique and findMany both return null/[] (default)
      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher'))

      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('join'))
      expect(result.nextStep).toBe('done')
    })

    it('provider not approved (inactive status) → sends buttons → returns done', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider({ active: true, status: 'SUSPENDED' }),
      )

      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('approved'),
        expect.arrayContaining([
          expect.objectContaining({ id: 'provider_status' }),
          expect.objectContaining({ id: 'back_home' }),
        ]),
      )
      expect(result.nextStep).toBe('done')
    })

    it('provider active=false → sends buttons → returns done', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider({ active: false, status: 'ACTIVE' }),
      )

      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher'))

      expect(wa.sendButtons).toHaveBeenCalled()
      expect(result.nextStep).toBe('done')
    })

    it('approved provider → sends voucher code prompt → returns pj_redeem_voucher_awaiting_code', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider(),
      )

      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher'))

      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('voucher code'))
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('PAP-'))
      expect(result.nextStep).toBe('pj_redeem_voucher_awaiting_code')
    })
  })

  // ── handleVoucherCodeEntry ────────────────────────────────────────────────

  describe('pj_redeem_voucher_awaiting_code step (handleVoucherCodeEntry)', () => {
    it('provider not found → sends not-registered message → returns done', async () => {
      // provider lookup returns null (default)
      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher_awaiting_code', 'PAP-7KQ9-M2XD'))

      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('join'))
      expect(result.nextStep).toBe('done')
    })

    it('empty reply text → re-prompts for voucher code → returns pj_redeem_voucher_awaiting_code', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider(),
      )

      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher_awaiting_code', ''))

      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('voucher code'))
      expect(result.nextStep).toBe('pj_redeem_voucher_awaiting_code')
      expect(voucherRedemption.redeemVoucher).not.toHaveBeenCalled()
    })

    it('whitespace-only reply → re-prompts → returns pj_redeem_voucher_awaiting_code', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider(),
      )

      const result = await handleProviderJourneyFlow(makeCtx('pj_redeem_voucher_awaiting_code', '   '))

      expect(result.nextStep).toBe('pj_redeem_voucher_awaiting_code')
      expect(voucherRedemption.redeemVoucher).not.toHaveBeenCalled()
    })

    it('valid code, redeemVoucher returns ok:true → sends success message → returns pj_credits', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider(),
      )
      ;(voucherRedemption.redeemVoucher as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })

      const result = await handleProviderJourneyFlow(
        makeCtx('pj_redeem_voucher_awaiting_code', 'PAP-7KQ9-M2XD'),
      )

      expect(voucherRedemption.redeemVoucher).toHaveBeenCalledWith('prov_1', 'PAP-7KQ9-M2XD')
      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Voucher redeemed successfully'),
      )
      expect(result.nextStep).toBe('pj_credits')
    })

    it('invalid code, redeemVoucher returns ok:false → sends mapped error message → returns pj_credits', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider(),
      )
      ;(voucherRedemption.redeemVoucher as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        code: 'VOUCHER_NOT_FOUND',
      })

      const result = await handleProviderJourneyFlow(
        makeCtx('pj_redeem_voucher_awaiting_code', 'PAP-XXXX-XXXX'),
      )

      expect(vouchers.mapVoucherRedemptionErrorToMessage).toHaveBeenCalledWith('VOUCHER_NOT_FOUND')
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, 'Error: VOUCHER_NOT_FOUND')
      expect(result.nextStep).toBe('pj_credits')
    })

    it('redeemVoucher throws unexpectedly → sends safe fallback message → returns pj_credits', async () => {
      ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeActiveProvider(),
      )
      ;(voucherRedemption.redeemVoucher as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB connection lost'),
      )

      const result = await handleProviderJourneyFlow(
        makeCtx('pj_redeem_voucher_awaiting_code', 'PAP-7KQ9-M2XD'),
      )

      expect(wa.sendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('Something went wrong'),
      )
      expect(result.nextStep).toBe('pj_credits')
    })
  })
})
