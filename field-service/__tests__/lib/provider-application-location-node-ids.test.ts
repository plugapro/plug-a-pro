import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── In-memory DB state ───────────────────────────────────────────────────────
//
// Mirrors the mock harness in __tests__/lib/provider-applications-submit.test.ts
// (the real providerApplication.create call site lives in
// lib/provider-applications-submit.ts — submitProviderApplication). This test
// only asserts the new locationNodeIds column reaches that create call; the
// existing suite covers the rest of submitProviderApplication's behavior.

type ApplicationRow = {
  id: string
  phone: string
  email: string | null
  name: string
  skills: string[]
  serviceAreas: string[]
  locationNodeIds: string[]
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
  notes: string | null
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
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = appStore.get(where.id)
      if (!row) throw new Error(`ProviderApplication not found: ${where.id}`)
      return row
    }),
    create: vi.fn(async ({ data }: { data: Omit<ApplicationRow, 'id' | 'submittedAt'> & { notes?: string | null } }) => {
      const id = nextAppId()
      const row: ApplicationRow = {
        id,
        submittedAt: new Date(),
        phone: data.phone,
        email: data.email ?? null,
        name: data.name,
        skills: data.skills ?? [],
        serviceAreas: data.serviceAreas ?? [],
        locationNodeIds: data.locationNodeIds ?? [],
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
        notes: data.notes ?? null,
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

const recordWorkflowEventMock = vi.fn(async (..._args: unknown[]) => ({ ok: true }))
vi.mock('@/lib/workflow-events', () => ({
  recordWorkflowEvent: recordWorkflowEventMock,
}))
const emitServerConversionMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@/lib/marketing/server-events', () => ({
  emitServerConversion: emitServerConversionMock,
}))

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
  mockDb.providerApplication.findUniqueOrThrow.mockImplementation(appMethods.findUniqueOrThrow.getMockImplementation()!)
  mockDb.providerApplication.create.mockImplementation(appMethods.create.getMockImplementation()!)
  mockDb.conversation.create.mockImplementation(convMethods.create.getMockImplementation()!)
  mockDb.conversation.findUnique.mockImplementation(convMethods.findUnique.getMockImplementation()!)
  mockDb.conversation.update.mockImplementation(convMethods.update.getMockImplementation()!)
  mockDb.conversation.updateMany.mockImplementation(convMethods.updateMany.getMockImplementation()!)
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb))
})

const baseInput = {
  phone: '+27000000199',
  name: 'Thabo Test',
  idNumber: '8001015009087',
  skills: ['plumbing'],
  serviceAreas: ['JHB North / Sandton'],
  locationNodeIds: ['n-1', 'n-2'],
  availability: ['Mon', 'Tue'],
  evidenceNote: '',
  experience: '',
}

describe('submitProviderApplication — locationNodeIds persistence [PJ-01]', () => {
  it('persists locationNodeIds on the created ProviderApplication', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')

    const result = await submitProviderApplication(mockDb as never, baseInput, { source: 'whatsapp' })

    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationNodeIds: ['n-1', 'n-2'] }),
      }),
    )
    expect((result.application as unknown as ApplicationRow).locationNodeIds).toEqual(['n-1', 'n-2'])
  })

  it('defaults locationNodeIds to [] when not provided', async () => {
    const { submitProviderApplication } = await import('@/lib/provider-applications-submit')
    const { locationNodeIds: _omit, ...inputWithoutLocationNodeIds } = baseInput

    await submitProviderApplication(mockDb as never, inputWithoutLocationNodeIds, { source: 'web' })

    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationNodeIds: [] }),
      }),
    )
  })
})
