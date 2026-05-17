import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getProviderLeadDetailForProvider } from '../../lib/provider-lead-detail'
import { createManualEftTopUpIntent } from '../../lib/provider-credit-payment-intents'
import { creditPaymentIntent, reconcilePaymentIntent } from '../../lib/provider-credit-reconciliation'
import { awardPromoCreditsForMilestone } from '../../lib/provider-promo-awards'
import { approveLeadUnlockDispute, disputeLeadUnlockForProvider } from '../../lib/lead-unlock-disputes'
import { getOrCreateProviderWallet } from '../../lib/provider-wallet'
import { unlockLeadForProvider } from '../../lib/lead-unlocks'

const { mockDb, mockNotifications, state } = vi.hoisted(() => {
  const state: {
    providers: Map<string, any>
    wallets: Map<string, any>
    leads: Map<string, any>
    unlocks: Map<string, any>
    disputes: Map<string, any>
    intents: Map<string, any>
    awards: Map<string, any>
    ledgerEntries: any[]
  } = {
    providers: new Map(),
    wallets: new Map(),
    leads: new Map(),
    unlocks: new Map(),
    disputes: new Map(),
    intents: new Map(),
    awards: new Map(),
    ledgerEntries: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    provider: { findUnique: vi.fn() },
    providerWallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    providerPromoAward: {
      aggregate: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    leadUnlock: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    leadUnlockDispute: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  }

  const mockNotifications = {
    notifyLeadUnlocked: vi.fn(),
    notifyProviderLowBalance: vi.fn(),
    notifyProviderPaymentIntentCreated: vi.fn(),
    notifyProviderPaymentCredited: vi.fn(),
  }

  return { mockDb, mockNotifications, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))

vi.mock('../../lib/provider-wallet-notifications', () => mockNotifications)

function wallet(providerId: string) {
  const existing = state.wallets.get(providerId)
  if (existing) return existing

  const created = {
    id: `wallet-${providerId}`,
    providerId,
    paidCreditBalance: 0,
    promoCreditBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-04-29T08:00:00.000Z'),
    updatedAt: new Date('2026-04-29T08:00:00.000Z'),
  }
  state.wallets.set(providerId, created)
  return created
}

function makeLead(id: string) {
  return {
    id,
    jobRequestId: `job-${id}`,
    providerId: 'provider-1',
    status: 'VIEWED',
    sentAt: new Date('2026-04-29T10:00:00.000Z'),
    expiresAt: new Date('2030-04-29T10:00:00.000Z'),
    provider: state.providers.get('provider-1'),
    jobRequest: {
      id: `job-${id}`,
      status: 'MATCHING',
      match: null,
      category: 'plumbing',
      title: `Leaking tap ${id}`,
      description: `Full notes for ${id}. Gate code 1234 is sensitive.`,
      requestedWindowStart: new Date('2026-05-01T09:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-01T11:00:00.000Z'),
      requestedArrivalLatest: null,
      customerAcceptedAmount: 800,
      customer: { id: `customer-${id}`, name: 'Nomsa Dlamini', phone: '+27821234567' },
      address: {
        street: '12 Exact Street',
        addressLine1: null,
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
      },
      attachments: [{ id: `photo-${id}`, caption: 'Leak photo', label: 'before' }],
    },
  }
}

function publicLead(lead: any) {
  const unlock = state.unlocks.get(lead.id) ?? null
  return {
    id: lead.id,
    providerId: lead.providerId,
    status: lead.status,
    sentAt: lead.sentAt,
    expiresAt: lead.expiresAt,
    unlock: unlock
      ? {
          id: unlock.id,
          providerId: unlock.providerId,
          status: unlock.status,
          refundReason: unlock.refundReason,
          dispute: [...state.disputes.values()].find((dispute) => dispute.leadUnlockId === unlock.id) ?? null,
        }
      : null,
    jobRequest: {
      id: lead.jobRequest.id,
      category: lead.jobRequest.category,
      title: lead.jobRequest.title,
      description: lead.jobRequest.description,
      requestedWindowStart: lead.jobRequest.requestedWindowStart,
      requestedWindowEnd: lead.jobRequest.requestedWindowEnd,
      requestedArrivalLatest: lead.jobRequest.requestedArrivalLatest,
      customerAcceptedAmount: lead.jobRequest.customerAcceptedAmount,
      address: {
        suburb: lead.jobRequest.address.suburb,
        city: lead.jobRequest.address.city,
      },
      attachments: lead.jobRequest.attachments,
    },
  }
}

function sensitiveLead(lead: any) {
  return {
    jobRequest: {
      description: lead.jobRequest.description,
      customer: lead.jobRequest.customer,
      address: lead.jobRequest.address,
      attachments: lead.jobRequest.attachments,
    },
  }
}

describe('provider credit wallet and paid lead monetisation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME', 'Plug A Pro provider credits')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BANK_NAME', 'Test Bank')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '123456789')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BRANCH_CODE', '250655')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_TYPE', 'Business current account')
    vi.stubEnv('PROVIDER_CREDIT_EFT_INTENT_EXPIRY_DAYS', '7')

    state.providers = new Map([[
      'provider-1',
      { id: 'provider-1', phone: '+27821234567', kycStatus: 'VERIFIED', active: true, verified: true, status: 'ACTIVE' },
    ]])
    state.wallets = new Map()
    state.leads = new Map([
      ['lead-1', makeLead('lead-1')],
      ['lead-2', makeLead('lead-2')],
    ])
    state.unlocks = new Map()
    state.disputes = new Map()
    state.intents = new Map()
    state.awards = new Map()
    state.ledgerEntries = []

    Object.values(mockNotifications).forEach((notification) => notification.mockResolvedValue(undefined))

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )

    mockDb.provider.findUnique.mockImplementation(async (args: any) => {
      const provider = state.providers.get(args.where.id)
      if (!provider) return null
      return { ...provider, wallet: state.wallets.get(provider.id) ?? null }
    })

    mockDb.providerWallet.findUnique.mockImplementation(async (args: any) => state.wallets.get(args.where.providerId) ?? null)
    mockDb.providerWallet.upsert.mockImplementation(async (args: any) => wallet(args.create.providerId))
    mockDb.providerWallet.update.mockImplementation(async (args: any) => {
      const current = [...state.wallets.values()].find((item) => item.id === args.where.id)
      const paidIncrement = args.data.paidCreditBalance?.increment ?? 0
      const promoIncrement = args.data.promoCreditBalance?.increment ?? 0
      const updated = {
        ...current,
        paidCreditBalance: current.paidCreditBalance + paidIncrement,
        promoCreditBalance: current.promoCreditBalance + promoIncrement,
        status: args.data.status ?? current.status,
      }
      state.wallets.set(updated.providerId, updated)
      return updated
    })
    mockDb.providerWallet.updateMany.mockImplementation(async (args: any) => {
      const current = [...state.wallets.values()].find((item) => item.id === args.where.id)
      const paidDecrement = args.data.paidCreditBalance?.decrement ?? 0
      const promoDecrement = args.data.promoCreditBalance?.decrement ?? 0
      const exactPaid = args.where.AND.find((clause: any) => typeof clause.paidCreditBalance === 'number')
        ?.paidCreditBalance
      const exactPromo = args.where.AND.find((clause: any) => typeof clause.promoCreditBalance === 'number')
        ?.promoCreditBalance
      if (
        !current ||
        current.paidCreditBalance !== exactPaid ||
        current.promoCreditBalance !== exactPromo ||
        current.paidCreditBalance < paidDecrement ||
        current.promoCreditBalance < promoDecrement
      ) {
        return { count: 0 }
      }
      const updated = {
        ...current,
        paidCreditBalance: current.paidCreditBalance - paidDecrement,
        promoCreditBalance: current.promoCreditBalance - promoDecrement,
      }
      state.wallets.set(updated.providerId, updated)
      return { count: 1 }
    })
    mockDb.providerWallet.findUniqueOrThrow.mockImplementation(async (args: any) => (
      [...state.wallets.values()].find((item) => item.id === args.where.id)
    ))

    mockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `ledger-${state.ledgerEntries.length + 1}`,
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        ...args.data,
      }
      state.ledgerEntries.push(entry)
      return entry
    })
    mockDb.walletLedgerEntry.findMany.mockImplementation(async (args: any) => (
      state.ledgerEntries.filter((entry) => (
        (!args.where.providerId || entry.providerId === args.where.providerId) &&
        (!args.where.referenceType || entry.referenceType === args.where.referenceType) &&
        (!args.where.referenceId || entry.referenceId === args.where.referenceId) &&
        (!args.where.entryType || entry.entryType === args.where.entryType)
      ))
    ))

    mockDb.providerPromoAward.aggregate.mockImplementation(async (args: any) => ({
      _sum: {
        creditsAwarded: [...state.awards.values()]
          .filter((award) => (
            award.providerId === args.where.providerId &&
            award.status === args.where.status &&
            args.where.awardType.in.includes(award.awardType)
          ))
          .reduce((sum, award) => sum + award.creditsAwarded, 0),
      },
    }))
    mockDb.providerPromoAward.findUnique.mockImplementation(async (args: any) => (
      state.awards.get(`${args.where.providerId_awardType.providerId}:${args.where.providerId_awardType.awardType}`) ?? null
    ))
    mockDb.providerPromoAward.createMany.mockImplementation(async (args: any) => {
      const award = {
        status: 'AWARDED',
        awardedAt: new Date('2026-04-29T10:00:00.000Z'),
        revokedAt: null,
        ...args.data[0],
      }
      const key = `${award.providerId}:${award.awardType}`
      if (state.awards.has(key)) return { count: 0 }
      state.awards.set(key, award)
      return { count: 1 }
    })

    mockDb.paymentIntent.count.mockImplementation(async (args: any) => (
      [...state.intents.values()].filter((intent) => (
        intent.providerId === args.where.providerId &&
        (!args.where.id?.not || intent.id !== args.where.id.not) &&
        (!args.where.status || intent.status === args.where.status) &&
        (!args.where.creditedAt?.not || intent.creditedAt != null)
      )).length
    ))
    mockDb.paymentIntent.findUnique.mockImplementation(async (args: any) => {
      if (args.where.id) return state.intents.get(args.where.id) ?? null
      if (args.where.paymentReference) {
        return [...state.intents.values()].find((intent) => intent.paymentReference === args.where.paymentReference) ?? null
      }
      return null
    })
    mockDb.paymentIntent.create.mockImplementation(async (args: any) => {
      const intent = {
        id: `intent-${state.intents.size + 1}`,
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        paidAt: null,
        creditedAt: null,
        gatewayReference: null,
        bankStatementReference: null,
        proofOfPaymentUrl: null,
        adminNote: null,
        ...args.data,
      }
      state.intents.set(intent.id, intent)
      return intent
    })
    mockDb.paymentIntent.update.mockImplementation(async (args: any) => {
      const intent = state.intents.get(args.where.id)
      const updated = { ...intent, ...args.data }
      state.intents.set(updated.id, updated)
      return updated
    })
    mockDb.paymentIntent.updateMany.mockImplementation(async (args: any) => {
      const intent = state.intents.get(args.where.id)
      if (!intent || !args.where.status.in.includes(intent.status) || intent.creditedAt !== args.where.creditedAt) {
        return { count: 0 }
      }
      state.intents.set(intent.id, { ...intent, ...args.data })
      return { count: 1 }
    })
    mockDb.paymentIntent.findUniqueOrThrow.mockImplementation(async (args: any) => state.intents.get(args.where.id))

    mockDb.lead.findUnique.mockImplementation(async (args: any) => {
      const lead = state.leads.get(args.where.id)
      if (!lead) return null
      if (args.include) {
        return {
          ...lead,
          provider: state.providers.get(lead.providerId),
          jobRequest: { ...lead.jobRequest, match: null },
        }
      }
      if (args.select?.jobRequest?.select?.customer) return sensitiveLead(lead)
      return publicLead(lead)
    })
    mockDb.lead.update.mockImplementation(async (args: any) => {
      const lead = state.leads.get(args.where.id)
      const updated = { ...lead, ...args.data }
      state.leads.set(updated.id, updated)
      return updated
    })

    mockDb.leadUnlock.findUnique.mockImplementation(async (args: any) => {
      if (args.where.leadId) return state.unlocks.get(args.where.leadId) ?? null
      if (args.where.id) return [...state.unlocks.values()].find((unlock) => unlock.id === args.where.id) ?? null
      return null
    })
    mockDb.leadUnlock.create.mockImplementation(async (args: any) => {
      const unlock = {
        id: `unlock-${args.data.leadId}`,
        unlockedAt: new Date('2026-04-29T10:00:00.000Z'),
        refundedAt: null,
        refundReason: null,
        resolvedAt: null,
        resolvedBy: null,
        ...args.data,
      }
      state.unlocks.set(unlock.leadId, unlock)
      return unlock
    })
    mockDb.leadUnlock.update.mockImplementation(async (args: any) => {
      const unlock = [...state.unlocks.values()].find((item) => item.id === args.where.id)
      const updated = { ...unlock, ...args.data }
      state.unlocks.set(updated.leadId, updated)
      return updated
    })
    mockDb.leadUnlock.updateMany.mockImplementation(async (args: any) => {
      const unlock = [...state.unlocks.values()].find((item) => item.id === args.where.id)
      if (!unlock || unlock.status !== args.where.status || unlock.refundedAt !== args.where.refundedAt) {
        return { count: 0 }
      }
      state.unlocks.set(unlock.leadId, { ...unlock, ...args.data })
      return { count: 1 }
    })
    mockDb.leadUnlock.findUniqueOrThrow.mockImplementation(async (args: any) => (
      [...state.unlocks.values()].find((unlock) => unlock.id === args.where.id)
    ))

    mockDb.leadUnlockDispute.findUnique.mockImplementation(async (args: any) => {
      const dispute = state.disputes.get(args.where.id)
      if (!dispute) return null
      const unlock = [...state.unlocks.values()].find((item) => item.id === dispute.leadUnlockId)
      return args.include?.leadUnlock ? { ...dispute, leadUnlock: unlock } : dispute
    })
    mockDb.leadUnlockDispute.create.mockImplementation(async (args: any) => {
      const dispute = {
        id: `dispute-${state.disputes.size + 1}`,
        status: 'OPEN',
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        resolvedAt: null,
        resolvedBy: null,
        adminNotes: null,
        ...args.data,
      }
      state.disputes.set(dispute.id, dispute)
      return dispute
    })
    mockDb.leadUnlockDispute.update.mockImplementation(async (args: any) => {
      const dispute = state.disputes.get(args.where.id)
      const updated = { ...dispute, ...args.data }
      state.disputes.set(updated.id, updated)
      return updated
    })
  })

  it('covers promo award, preview safety, unlock debit, EFT crediting, paid debit, refund, and low-balance hooks', async () => {
    await expect(getOrCreateProviderWallet('provider-1')).resolves.toMatchObject({
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })

    await awardPromoCreditsForMilestone('provider-1', 'MOBILE_VERIFIED', {
      referenceType: 'provider',
      referenceId: 'provider-1',
    })
    expect(wallet('provider-1')).toMatchObject({ paidCreditBalance: 0, promoCreditBalance: 3 })

    const preview = await getProviderLeadDetailForProvider('lead-1', 'provider-1')
    expect(preview?.unlockedDetails).toBeNull()
    expect(JSON.stringify(preview)).not.toContain('+27821234567')
    expect(JSON.stringify(preview)).not.toContain('12 Exact Street')

    await unlockLeadForProvider('lead-1', 'provider-1')
    expect(wallet('provider-1')).toMatchObject({ paidCreditBalance: 0, promoCreditBalance: 2 })
    expect(state.ledgerEntries).toContainEqual(expect.objectContaining({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      referenceId: 'unlock-lead-1',
    }))

    const unlockOnly = await getProviderLeadDetailForProvider('lead-1', 'provider-1')
    expect(unlockOnly?.unlockedDetails).toBeNull()

    state.leads.set('lead-1', { ...state.leads.get('lead-1'), status: 'ACCEPTED' })
    const accepted = await getProviderLeadDetailForProvider('lead-1', 'provider-1')
    expect(accepted?.unlockedDetails).toMatchObject({
      customerPhone: '+27821234567',
      fullAddress: expect.stringContaining('12 Exact Street'),
    })

    const topUp = await createManualEftTopUpIntent({
      providerId: 'provider-1',
      amountCents: 10_000,
      referenceGenerator: () => 'PAP-7842-9F3K',
    })
    expect(topUp.intent).toMatchObject({
      status: 'PENDING_PAYMENT',
      creditsToIssue: 2,
    })
    expect(wallet('provider-1')).toMatchObject({ paidCreditBalance: 0, promoCreditBalance: 2 })

    await reconcilePaymentIntent('intent-1', 'admin-1', 'BANK-PAP-7842-9F3K', {
      statementAmountCents: 10_000,
      adminNote: 'Funds confirmed',
    })
    await creditPaymentIntent('intent-1', 'admin-1', { adminNote: 'Credit approved' })
    expect(wallet('provider-1')).toMatchObject({ paidCreditBalance: 2, promoCreditBalance: 2 })

    // Promo-first debit is intentional. This simulates prior promo exhaustion so
    // the second unlock validates the paid-credit path after the confirmed top-up.
    state.wallets.set('provider-1', { ...wallet('provider-1'), promoCreditBalance: 0 })
    await unlockLeadForProvider('lead-2', 'provider-1')
    expect(wallet('provider-1')).toMatchObject({ paidCreditBalance: 1, promoCreditBalance: 0 })
    expect(state.ledgerEntries).toContainEqual(expect.objectContaining({
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PAID',
      referenceId: 'unlock-lead-2',
    }))

    await disputeLeadUnlockForProvider(
      'lead-1',
      'provider-1',
      'INVALID_CUSTOMER_NUMBER',
      'Number does not connect.',
    )
    await approveLeadUnlockDispute('dispute-1', 'admin-1', 'Invalid number confirmed')
    expect(wallet('provider-1')).toMatchObject({ paidCreditBalance: 1, promoCreditBalance: 1 })
    expect(state.ledgerEntries).toContainEqual(expect.objectContaining({
      entryType: 'LEAD_REFUND_CREDIT',
      creditType: 'PROMO',
      referenceType: 'lead_unlock_dispute',
    }))
    expect(mockNotifications.notifyProviderLowBalance).toHaveBeenCalled()
  })
})
