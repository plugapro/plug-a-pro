// ─── Case lifecycle tests ─────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => {
  const makeChain = (result: unknown) => ({
    findUnique:       vi.fn().mockResolvedValue(result),
    findUniqueOrThrow: vi.fn().mockResolvedValue(result),
    create:           vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'case_1', state: 'OPEN', ownerUserId: null, ...data })),
    update:           vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'case_1', ...data })),
  })

  const txMock = vi.fn().mockImplementation(async (fns: Array<Promise<unknown>>) => fns)

  return {
    db: {
      case:      makeChain({ id: 'case_1', state: 'OPEN', ownerUserId: null, queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: 'jr_1', events: [] }),
      caseNote:  makeChain({ id: 'note_1' }),
      caseEvent: makeChain({ id: 'event_1' }),
      $transaction: txMock,
    },
  }
})

vi.mock('@/lib/sla', () => ({
  slaFor: vi.fn().mockReturnValue({ targetMinutes: 60, warningAtMinutes: 45, targetLabel: '1h' }),
}))

vi.mock('@/lib/reason-codes', () => ({
  noteRequiredForCode: vi.fn().mockReturnValue(false),
}))

import { db } from '@/lib/db'
import { noteRequiredForCode } from '@/lib/reason-codes'
import {
  openCase,
  claimCase,
  releaseCase,
  reassignCase,
  resolveCase,
  reopenCase,
  addNote,
  addEvent,
  markBreach,
} from '@/lib/cases'

const mockCase     = db.case     as unknown as { findUnique: ReturnType<typeof vi.fn>; findUniqueOrThrow: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
const mockCaseNote = db.caseNote as unknown as { create: ReturnType<typeof vi.fn> }
const mockNoteReq  = noteRequiredForCode as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  // Default: case does not exist (for openCase idempotency tests)
  mockCase.findUnique.mockResolvedValue(null)
  mockCase.findUniqueOrThrow.mockResolvedValue({
    id: 'case_1', state: 'OPEN', ownerUserId: null, queueType: 'DISPATCH',
    entityType: 'JOB_REQUEST', entityId: 'jr_1', events: [],
  })
  mockCase.create.mockResolvedValue({ id: 'case_1', state: 'OPEN' })
  mockCase.update.mockResolvedValue({ id: 'case_1', state: 'IN_PROGRESS', ownerUserId: 'user_1' })
  mockCaseNote.create.mockResolvedValue({ id: 'note_1' })
  mockNoteReq.mockReturnValue(false)
  ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fns: Array<Promise<unknown>>) => Promise.all(fns),
  )
})

// ─── openCase ─────────────────────────────────────────────────────────────────

describe('openCase', () => {
  it('creates a new case when none exists', async () => {
    const result = await openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: 'jr_1' })
    expect(mockCase.create).toHaveBeenCalledOnce()
    expect(result.id).toBe('case_1')
  })

  it('returns existing case without creating a duplicate', async () => {
    mockCase.findUnique.mockResolvedValue({ id: 'case_1', state: 'OPEN' })
    const result = await openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: 'jr_1' })
    expect(mockCase.create).not.toHaveBeenCalled()
    expect(result.id).toBe('case_1')
  })

  it('sets slaDueAt based on slaFor targetMinutes', async () => {
    await openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: 'jr_1' })
    const createCall = mockCase.create.mock.calls[0][0]
    expect(createCall.data.slaDueAt).toBeInstanceOf(Date)
  })
})

// ─── claimCase ────────────────────────────────────────────────────────────────

describe('claimCase', () => {
  it('sets ownerUserId and transitions OPEN → IN_PROGRESS', async () => {
    await claimCase({ caseId: 'case_1', userId: 'user_1' })
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.ownerUserId).toBe('user_1')
    expect(updateCall.data.state).toBe('IN_PROGRESS')
  })

  it('does not override state if already IN_PROGRESS', async () => {
    mockCase.findUniqueOrThrow.mockResolvedValue({
      id: 'case_1', state: 'IN_PROGRESS', ownerUserId: 'user_2', queueType: 'DISPATCH',
      entityType: 'JOB_REQUEST', entityId: 'jr_1', events: [],
    })
    await claimCase({ caseId: 'case_1', userId: 'user_1' })
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.state).toBe('IN_PROGRESS') // unchanged
  })

  it('emits ASSIGNMENT_CHANGE event', async () => {
    await claimCase({ caseId: 'case_1', userId: 'user_1' })
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.events.create.type).toBe('ASSIGNMENT_CHANGE')
    expect(updateCall.data.events.create.actorUserId).toBe('user_1')
  })
})

// ─── releaseCase ──────────────────────────────────────────────────────────────

describe('releaseCase', () => {
  it('clears ownerUserId and resets state to OPEN', async () => {
    await releaseCase('case_1', 'user_1')
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.ownerUserId).toBeNull()
    expect(updateCall.data.state).toBe('OPEN')
  })
})

// ─── reassignCase ─────────────────────────────────────────────────────────────

describe('reassignCase', () => {
  it('sets new ownerUserId and emits ASSIGNMENT_CHANGE', async () => {
    await reassignCase('case_1', 'user_new', 'user_actor')
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.ownerUserId).toBe('user_new')
    expect(updateCall.data.events.create.type).toBe('ASSIGNMENT_CHANGE')
    expect(updateCall.data.events.create.payload.to).toBe('user_new')
  })
})

// ─── resolveCase ──────────────────────────────────────────────────────────────

describe('resolveCase', () => {
  it('resolves with reasonCode and sets resolvedAt', async () => {
    await resolveCase({ caseId: 'case_1', resolvedBy: 'user_1', reasonCode: 'COVERAGE_GAP' })
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.state).toBe('RESOLVED')
    expect(updateCall.data.reasonCode).toBe('COVERAGE_GAP')
    expect(updateCall.data.resolvedAt).toBeInstanceOf(Date)
    expect(updateCall.data.resolvedBy).toBe('user_1')
  })

  it('throws when note is required but missing', async () => {
    mockNoteReq.mockReturnValue(true)
    await expect(
      resolveCase({ caseId: 'case_1', resolvedBy: 'user_1', reasonCode: 'OTHER' }),
    ).rejects.toThrow('A note is required')
  })

  it('accepts a note when noteRequired', async () => {
    mockNoteReq.mockReturnValue(true)
    await expect(
      resolveCase({ caseId: 'case_1', resolvedBy: 'user_1', reasonCode: 'OTHER', note: 'details here' }),
    ).resolves.toBeDefined()
  })

  it('creates an inline note when one is provided', async () => {
    await resolveCase({ caseId: 'case_1', resolvedBy: 'user_1', reasonCode: 'COVERAGE_GAP', note: 'area note' })
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.notes?.create?.body).toBe('area note')
  })

  it('does not create note when none provided', async () => {
    await resolveCase({ caseId: 'case_1', resolvedBy: 'user_1', reasonCode: 'COVERAGE_GAP' })
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.notes).toBeUndefined()
  })
})

// ─── reopenCase ───────────────────────────────────────────────────────────────

describe('reopenCase', () => {
  it('sets state to REOPENED and clears resolution fields', async () => {
    await reopenCase('case_1', 'user_1', 'customer callback required')
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.state).toBe('REOPENED')
    expect(updateCall.data.resolvedAt).toBeNull()
    expect(updateCall.data.resolvedBy).toBeNull()
  })

  it('emits STATE_CHANGE event with reason', async () => {
    await reopenCase('case_1', 'user_1', 'new info')
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.events.create.type).toBe('STATE_CHANGE')
    expect(updateCall.data.events.create.payload.reason).toBe('new info')
  })
})

// ─── addNote ──────────────────────────────────────────────────────────────────

describe('addNote', () => {
  it('creates a note and fires NOTE_ADDED event in a transaction', async () => {
    await addNote({ caseId: 'case_1', authorUserId: 'user_1', body: 'called customer' })
    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(mockCaseNote.create).toHaveBeenCalledOnce()
    const noteCall = mockCaseNote.create.mock.calls[0][0]
    expect(noteCall.data.body).toBe('called customer')
    expect(noteCall.data.authorUserId).toBe('user_1')
  })
})

// ─── markBreach ───────────────────────────────────────────────────────────────

describe('markBreach', () => {
  it('fires BREACH_DETECTED when not already marked', async () => {
    await markBreach('case_1')
    expect(mockCase.update).toHaveBeenCalledOnce()
    const updateCall = mockCase.update.mock.calls[0][0]
    expect(updateCall.data.events.create.type).toBe('BREACH_DETECTED')
  })

  it('does nothing if BREACH_DETECTED event already exists', async () => {
    mockCase.findUniqueOrThrow.mockResolvedValue({
      id: 'case_1', state: 'IN_PROGRESS', queueType: 'DISPATCH',
      entityType: 'JOB_REQUEST', entityId: 'jr_1',
      events: [{ id: 'ev_1', type: 'BREACH_DETECTED' }],
    })
    await markBreach('case_1')
    expect(mockCase.update).not.toHaveBeenCalled()
  })
})
