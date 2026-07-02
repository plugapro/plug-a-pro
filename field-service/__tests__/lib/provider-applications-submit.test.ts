import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── In-memory DB state ───────────────────────────────────────────────────────

type ApplicationRow = {
  id: string
  phone: string
  email: string | null
  name: string
  skills: string[]
  serviceAreas: string[]
  experience: string | null
  availability: string | null
  callOutFee: number | null
  hourlyRate: number | null
  rateNegotiable: boolean
  weekendJobs: boolean
  sameDayJobs: boolean
  evidenceNote: string | null
  evidenceFileUrls: string[]
  idNumber: string | null
  alternateMobileE164: string | null
  preferredLanguage: string | null
  reference1Name: string | null
  reference1Mobile: string | null
  reference2Name: string | null
  reference2Mobile: string | null
  isTestUser: boolean
  cohortName: string | null
  providerId: string | null
  status: string
  submittedAt: Date
}

type ConversationRow = {
  id: string
  phone: string
  flow: string
  step: string
  data: Record<string, unknown>
  expiresAt: Date
}

let appStore: Map<string, ApplicationRow> = new Map()
let convStore: Map<string, ConversationRow> = new Map()
let appIdSeq = 0
let convIdSeq = 0

function nextAppId() { return `app-${++appIdSeq}` }
function nextConvId() { return `conv-${++convIdSeq}` }

function makeAppMethods() {
  return {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      for (const row of appStore.values()) {
        if (where.phone && row.phone !== where.phone) continue
        if (where.status && typeof where.status === 'object') {
          const statusFilter = where.status as { notIn?: string[]; in?: string[] }
          if (statusFilter.notIn && statusFilter.notIn.includes(row.status)) continue
          if (statusFilter.in && !statusFilter.in.includes(row.status)) continue
        }
        return row
      }
      return null
    }),
    create: vi.fn(async ({ data }: { data: Omit<ApplicationRow, 'id' | 'submittedAt'> }) => {
      const id = nextAppId()
      const row: ApplicationRow = {
        id,
        submittedAt: new Date(),
        phone: data.phone,
        email: data.email ?? null,
        name: data.name,
        skills: data.skills ?? [],
        serviceAreas: data.serviceAreas ?? [],
        experience: data.experience ?? null,
        availability: data.availability ?? null,
        callOutFee: data.callOutFee ?? null,
        hourlyRate: data.hourlyRate ?? null,
        rateNegotiable: data.rateNegotiable ?? true,
        weekendJobs: data.weekendJobs ?? false,
        sameDayJobs: data.sameDayJobs ?? true,
        evidenceNote: data.evidenceNote ?? null,
        evidenceFileUrls: data.evidenceFileUrls ?? [],
        idNumber: data.idNumber ?? null,
        alternateMobileE164: data.alternateMobileE164 ?? null,
        preferredLanguage: data.preferredLanguage ?? null,
        reference1Name: data.reference1Name ?? null,
        reference1Mobile: data.reference1Mobile ?? null,
        reference2Name: data.reference2Name ?? null,
        reference2Mobile: data.reference2Mobile ?? null,
        isTestUser: data.isTestUser ?? false,
        cohortName: data.cohortName ?? null,
        providerId: data.providerId ?? null,
        status: data.status ?? 'PENDING',
      }
      appStore.set(id, row)
      return row
    }),
  }
}

function makeConvMethods() {
  return {
    create: vi.fn(async ({ data }: { data: Omit<ConversationRow, 'id'> }) => {
      const id = nextConvId()
      const row: ConversationRow = { id, ...data }
      convStore.set(id, row)
      return row
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return convStore.get(where.id) ?? null
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ConversationRow> }) => {
      const row = convStore.get(where.id)
      if (!row) throw new Error(`Conversation not found: ${where.id}`)
      Object.assign(row, data)
      return row
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ConversationRow> }) => {
      let count = 0
      for (const row of convStore.values()) {
        if (where.phone && row.phone !== where.phone) continue
        if (where.flow && row.flow !== where.flow) continue
        Object.assign(row, data)
        count++
      }
      return { count }
    }),
  }
}

let mockDb = {
  providerApplication: makeAppMethods(),
  conversation: makeConvMethods(),
  $transaction: vi.fn(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb)),
}

vi.mock('@/lib/db', () => ({ db: mockDb }))

// Funnel telemetry + server-side conversions are unit-tested separately;
// here we only assert they are invoked with the right shape.
const recordWorkflowEventMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }))
vi.mock('@/lib/workflow-events', () => ({
  recordWorkflowEvent: recordWorkflowEventMock,
}))
const emitServerConversionMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@/lib/marketing/server-events', () => ({
  emitServerConversion: emitServerConversionMock,
}))

// ─── Reset state before each test ────────────────────────────────────────────

beforeEach(() => {
  appStore = new Map()
  convStore = new Map()
  appIdSeq = 0
  convIdSeq = 0
  recordWorkflowEventMock.mockClear()
  emitServerConversionMock.mockClear()

  const appMethods = makeAppMethods()
  const convMethods = makeConvMethods()

  mockDb.providerApplication.findFirst.mockImplementation(appMethods.findFirst.getMockImplementation()!)
  mockDb.providerApplication.create.mockImplementation(appMethods.create.getMockImplementation()!)
  mockDb.conversation.create.mockImplementation(convMethods.create.getMockImplementation()!)
  mockDb.conversation.findUnique.mockImplementation(convMethods.findUnique.getMockImplementation()!)
  mockDb.conversation.update.mockImplementation(convMethods.update.getMockImplementation()!)
  mockDb.conversation.updateMany.mockImplementation(convMethods.updateMany.getMockImplementation()!)
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb))
})

// ─── Base input ───────────────────────────────────────────────────────────────

const baseInput = {
  phone: '+27000000099',
  name: 'Vusi Test',
  idNumber: '8001015009087',
  skills: ['plumbing'],
  serviceAreas: ['JHB North / Sandton'],
  availability: ['Mon', 'Tue'],
  evidenceNote: '',
  experience: '',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('submitProviderApplication', () => {
  it('creates a ProviderApplication with status PENDING from whatsapp source', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    const result = await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })

    expect(result.application.status).toBe('PENDING')
    expect(result.application.phone).toBe(baseInput.phone)
    expect(result.application.skills).toEqual(['plumbing'])
  })

  it('creates an identical-shape ProviderApplication from web source', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    const result = await submitProviderApplication(mockDb as never, baseInput, { source: 'web' })

    expect(result.application.status).toBe('PENDING')
    expect(result.application.name).toBe(baseInput.name)
  })

  it('rejects if a non-CANCELLED/non-REJECTED application already exists for the phone', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })

    await expect(
      submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' }),
    ).rejects.toThrow(/already.*application/i)
  })

  it('rejects with a typed conflict error', async () => {
    const { submitProviderApplication, ProviderApplicationConflictError } = await import('@/lib/provider-applications-submit')
    await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })

    await expect(
      submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' }),
    ).rejects.toThrow(ProviderApplicationConflictError)

    try {
      await submitProviderApplication(mockDb as never, baseInput, { source: 'web' })
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderApplicationConflictError)
      expect((err as InstanceType<typeof ProviderApplicationConflictError>).code).toBe('APPLICATION_CONFLICT')
    }
  })

  it('updates the linked Conversation to step reg_pending when conversationId is given', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')

    // Seed a conversation in the mock store
    const conv = await mockDb.conversation.create({
      data: {
        phone: baseInput.phone,
        flow: 'registration',
        step: 'reg_collect_evidence',
        data: { name: baseInput.name, skills: baseInput.skills },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    await submitProviderApplication(mockDb as never, baseInput, { source: 'web', conversationId: conv.id })

    const after = await mockDb.conversation.findUnique({ where: { id: conv.id } })
    expect(after?.step).toBe('reg_pending')
  })

  it('calls updateMany when no conversationId is provided', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')

    // Seed a conversation that should be caught by updateMany
    await mockDb.conversation.create({
      data: {
        phone: baseInput.phone,
        flow: 'registration',
        step: 'reg_collect_evidence',
        data: {},
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })

    expect(mockDb.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ phone: baseInput.phone, flow: 'registration' }),
        data: expect.objectContaining({ step: 'reg_pending' }),
      }),
    )

    // Verify state was actually updated
    const rows = Array.from(convStore.values())
    expect(rows[0].step).toBe('reg_pending')
  })

  it('persists CTWA attribution columns when ctwaReferral is provided', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    await submitProviderApplication(
      mockDb as never,
      {
        ...baseInput,
        ctwaReferral: {
          sourceType: 'ad',
          sourceId: '120245406174700243',
          ctwaClid: 'clid-abc',
          headline: 'Plug A Pro',
          capturedAt: '2026-07-01T08:00:00.000Z',
        },
      },
      { source: 'whatsapp' },
    )

    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ctwaSourceType: 'ad',
          ctwaSourceId: '120245406174700243',
          ctwaClid: 'clid-abc',
          ctwaHeadline: 'Plug A Pro',
          ctwaCapturedAt: new Date('2026-07-01T08:00:00.000Z'),
        }),
      }),
    )
  })

  it('defaults CTWA columns to null when no referral was captured', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })

    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ctwaSourceType: null,
          ctwaSourceId: null,
          ctwaClid: null,
          ctwaHeadline: null,
          ctwaCapturedAt: null,
        }),
      }),
    )
  })

  it('records a PROVIDER_APPLICATION_SUBMITTED workflow event after the submit', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    const result = await submitProviderApplication(
      mockDb as never,
      { ...baseInput, ctwaReferral: { sourceType: 'ad', sourceId: 'ad-1', ctwaClid: null, headline: null, capturedAt: '2026-07-01T08:00:00.000Z' } },
      { source: 'whatsapp' },
    )

    expect(recordWorkflowEventMock).toHaveBeenCalledTimes(1)
    expect(recordWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_APPLICATION_SUBMITTED',
        entityType: 'PROVIDER_APPLICATION',
        entityId: result.application.id,
        source: 'whatsapp',
        metadata: expect.objectContaining({ hasCtwaAttribution: true, ctwaSourceId: 'ad-1' }),
      }),
    )
  })

  it('does not fail the submit when the workflow event emit throws', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    recordWorkflowEventMock.mockRejectedValueOnce(new Error('telemetry down'))

    const result = await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })
    expect(result.application.status).toBe('PENDING')
  })

  it('emits a provider_application_submitted server conversion with the ctwa click id', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    const result = await submitProviderApplication(
      mockDb as never,
      { ...baseInput, ctwaReferral: { sourceType: 'ad', sourceId: 'ad-1', ctwaClid: 'clid-xyz', headline: null, capturedAt: '2026-07-01T08:00:00.000Z' } },
      { source: 'whatsapp' },
    )

    expect(emitServerConversionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'provider_application_submitted',
        entityId: result.application.id,
        ctwaClid: 'clid-xyz',
        customParams: expect.objectContaining({ source: 'whatsapp', ctwa_source_id: 'ad-1' }),
      }),
    )
  })

  it('does NOT emit a server conversion for test users', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    await submitProviderApplication(mockDb as never, { ...baseInput, isTestUser: true }, { source: 'whatsapp' })

    expect(emitServerConversionMock).not.toHaveBeenCalled()
    // The workflow event still fires (marked isTestUser) so funnel reports can filter it.
    expect(recordWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ isTestUser: true }) }),
    )
  })
})
