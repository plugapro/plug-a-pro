import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderLeadDetailError,
  getProviderLeadDetailForProvider,
} from '../../lib/provider-lead-detail'

const { mockDb, state } = vi.hoisted(() => {
  const state: {
    provider: any
    lead: any
    sensitiveLead: any
  } = {
    provider: null,
    lead: null,
    sensitiveLead: null,
  }

  const mockDb = {
    provider: {
      findUnique: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
    },
  }

  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    kycStatus: 'VERIFIED',
    wallet: {
      paidCreditBalance: 2,
      promoCreditBalance: 1,
    },
    ...overrides,
  }
}

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    status: 'VIEWED',
    sentAt: new Date('2026-04-29T10:00:00.000Z'),
    expiresAt: new Date('2026-04-30T10:00:00.000Z'),
    unlock: null,
    jobRequest: {
      id: 'job-request-1',
      category: 'Plumbing',
      title: 'Leaking bathroom tap',
      description: `${'Please inspect the bathroom tap. '.repeat(8)}Gate code 1234 and exact unit details after unlock.`,
      requestedWindowStart: new Date('2026-05-01T09:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-01T11:00:00.000Z'),
      requestedArrivalLatest: null,
      customerAcceptedAmount: 800,
      address: {
        suburb: 'Sandton',
        city: 'Johannesburg',
      },
    },
    ...overrides,
  }
}

function makeSensitiveLead() {
  return {
    jobRequest: {
      description: 'Full job notes include gate code 1234 and exact unit details.',
      customer: {
        name: 'Nomsa Dlamini',
        phone: '+27821234567',
      },
      address: {
        street: '12 Exact Street',
        addressLine1: 'Block B',
        addressLine2: null,
        complexName: 'Hidden Complex',
        unitNumber: 'Unit 7',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
      },
      attachments: [
        {
          id: 'attachment-1',
          caption: 'Leaking tap photo',
          label: 'before',
        },
      ],
    },
  }
}

describe('provider lead detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.provider = makeProvider()
    state.lead = makeLead()
    state.sensitiveLead = makeSensitiveLead()

    mockDb.provider.findUnique.mockImplementation(async () => state.provider)
    mockDb.lead.findUnique.mockImplementation(async () => {
      if (mockDb.lead.findUnique.mock.calls.length === 1) return state.lead
      return state.sensitiveLead
    })
  })

  it('returns only preview-safe lead data before unlock', async () => {
    const result = await getProviderLeadDetailForProvider('lead-1', 'provider-1')

    expect(result).toMatchObject({
      id: 'lead-1',
      isUnlocked: false,
      wallet: {
        paidCredits: 2,
        promoCredits: 1,
        totalCredits: 3,
      },
      preview: {
        category: 'Plumbing',
        jobType: 'Leaking bathroom tap',
        area: 'Sandton, Johannesburg',
        estimatedValue: 800,
      },
      unlockedDetails: null,
    })
    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('Nomsa Dlamini')
    expect(JSON.stringify(result)).not.toContain('+27821234567')
    expect(JSON.stringify(result)).not.toContain('12 Exact Street')
    expect(JSON.stringify(result)).not.toContain('Gate code 1234')
  })

  it('returns sensitive customer details only after provider unlock', async () => {
    state.lead = makeLead({
      unlock: {
        id: 'unlock-1',
        providerId: 'provider-1',
        status: 'UNLOCKED',
        refundReason: null,
        dispute: null,
      },
    })

    const result = await getProviderLeadDetailForProvider('lead-1', 'provider-1')

    expect(mockDb.lead.findUnique).toHaveBeenCalledTimes(2)
    expect(result?.isUnlocked).toBe(true)
    expect(result?.unlockedDetails).toMatchObject({
      customerName: 'Nomsa Dlamini',
      customerPhone: '+27821234567',
      whatsappHref: 'https://wa.me/27821234567',
      fullAddress: 'Unit 7, Hidden Complex, 12 Exact Street, Block B, Sandton, Johannesburg, Gauteng',
      fullNotes: 'Full job notes include gate code 1234 and exact unit details.',
      attachments: [
        {
          id: 'attachment-1',
          caption: 'Leaking tap photo',
          label: 'before',
        },
      ],
    })
  })

  it('blocks providers from loading another provider lead', async () => {
    state.lead = makeLead({ providerId: 'provider-2' })

    await expect(
      getProviderLeadDetailForProvider('lead-1', 'provider-1'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<ProviderLeadDetailError>)
  })
})
