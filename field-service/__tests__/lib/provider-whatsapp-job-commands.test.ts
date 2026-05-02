import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeProviderJobFromWhatsApp,
  executeProviderJobCommand,
  parseProviderJobCommand,
} from '../../lib/provider-whatsapp-job-commands'

const { mockDb, state } = vi.hoisted(() => {
  const state: { provider: any; jobs: any[]; updatedJob: any | null; statusEvent: any | null } = {
    provider: null,
    jobs: [],
    updatedJob: null,
    statusEvent: null,
  }
  const mockDb = {
    provider: {
      findFirst: vi.fn(),
    },
    job: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    jobStatusEvent: {
      create: vi.fn(),
    },
    attachment: {
      update: vi.fn(),
    },
  }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/jobs', () => ({
  transitionJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
}))

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'SCHEDULED',
    scheduledArrivalAt: null,
    bookingId: 'booking-1',
    booking: {
      match: {
        jobRequest: {
          category: 'Plumbing',
          customer: { name: 'Nomsa Customer', phone: '+27222222222' },
        },
      },
    },
    ...overrides,
  }
}

describe('parseProviderJobCommand', () => {
  it('parses bare HH:MM into an arrival command', () => {
    const result = parseProviderJobCommand('14:00')
    expect(result?.kind).toBe('arrive')
    expect(result && 'arrivalAt' in result && result.arrivalAt.getHours()).toBe(14)
  })

  it('parses confirm arrival HH:MM into an arrival command', () => {
    const result = parseProviderJobCommand('confirm arrival 14:00')
    expect(result?.kind).toBe('arrive')
    expect(result && 'arrivalAt' in result && result.arrivalAt.getHours()).toBe(14)
  })

  it('parses arrive 14:00 into a Date for the same day or next day', () => {
    const result = parseProviderJobCommand('arrive 14:00')
    expect(result?.kind).toBe('arrive')
    expect(result && 'arrivalAt' in result && result.arrivalAt.getHours()).toBe(14)
  })

  it('parses arrive 9am as 09:00', () => {
    const result = parseProviderJobCommand('arrive 9am')
    expect(result?.kind).toBe('arrive')
    expect(result && 'arrivalAt' in result && result.arrivalAt.getHours()).toBe(9)
  })

  it('parses on the way alias to on_the_way', () => {
    expect(parseProviderJobCommand('on the way')?.kind).toBe('on_the_way')
    expect(parseProviderJobCommand('OTW')?.kind).toBe('on_the_way')
  })

  it('parses arrived alias to arrived', () => {
    expect(parseProviderJobCommand("I've arrived")?.kind).toBe('arrived')
    expect(parseProviderJobCommand('Arrived')?.kind).toBe('arrived')
  })

  it('parses complete to complete', () => {
    expect(parseProviderJobCommand('done')?.kind).toBe('complete')
    expect(parseProviderJobCommand('finished')?.kind).toBe('complete')
  })

  it('returns null for non-command text', () => {
    expect(parseProviderJobCommand('hello there')).toBeNull()
    expect(parseProviderJobCommand('')).toBeNull()
    expect(parseProviderJobCommand(null)).toBeNull()
  })
})

describe('executeProviderJobCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.provider = { id: 'provider-1', name: 'Alice Plumbing' }
    state.jobs = [makeJob()]
    mockDb.provider.findFirst.mockResolvedValue(state.provider)
    mockDb.job.findMany.mockResolvedValue(state.jobs)
    mockDb.job.findFirst.mockResolvedValue({ id: 'job-1', status: 'STARTED' })
    mockDb.job.update.mockResolvedValue({ id: 'job-1' })
    mockDb.jobStatusEvent.create.mockResolvedValue({ id: 'event-1' })
    mockDb.attachment.update.mockResolvedValue({ id: 'attachment-1' })
  })

  it('rejects when provider is not found', async () => {
    mockDb.provider.findFirst.mockResolvedValueOnce(null)
    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('arrived')!,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('PROVIDER_NOT_FOUND')
  })

  it('rejects when no active job exists', async () => {
    mockDb.job.findMany.mockResolvedValueOnce([])
    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('arrived')!,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('NO_ACTIVE_JOB')
  })

  it('rejects when more than one active job exists', async () => {
    mockDb.job.findMany.mockResolvedValueOnce([
      makeJob(),
      makeJob({ id: 'job-2', status: 'EN_ROUTE' }),
    ])
    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('arrived')!,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('AMBIGUOUS_JOB')
  })

  it('updates scheduledArrivalAt for arrive HH:MM', async () => {
    const { sendText } = await import('../../lib/whatsapp-interactive')
    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('arrive 14:00')!,
    })
    expect(result.ok).toBe(true)
    expect(mockDb.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        scheduledArrivalAt: expect.any(Date),
        arrivalTimeConfirmedAt: expect.any(Date),
      }),
    })
    expect(mockDb.jobStatusEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        jobId: 'job-1',
        actorRole: 'provider',
      }),
    }))
    expect(sendText).toHaveBeenCalledWith(
      '+27222222222',
      expect.stringContaining('Alice Plumbing confirmed arrival'),
      expect.objectContaining({
        templateName: 'provider_arrival_time_confirmed',
        metadata: expect.objectContaining({ action: 'arrival_time_confirmed' }),
      }),
    )
    expect(result.ok && result.message).toContain('Arrival time confirmed')
    expect(result.ok && result.message).toContain('Customer has been notified')
  })

  it('does not resend arrival notification for identical duplicate arrival time', async () => {
    const { sendText } = await import('../../lib/whatsapp-interactive')
    const arrival = new Date()
    arrival.setHours(14, 0, 0, 0)
    mockDb.job.findMany.mockResolvedValueOnce([makeJob({ scheduledArrivalAt: arrival })])

    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: { kind: 'arrive', arrivalAt: arrival, raw: '14:00' },
    })

    expect(result.ok).toBe(true)
    expect(mockDb.job.update).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  it('transitions SCHEDULED to EN_ROUTE on "on the way"', async () => {
    const { transitionJob } = await import('../../lib/jobs')
    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('on the way')!,
    })
    expect(result.ok).toBe(true)
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      toStatus: 'EN_ROUTE',
      actorRole: 'provider',
    }))
    expect(result.ok && result.message).toContain('Status updated: On the way')
    expect(result.ok && result.message).toContain('Customer notified')
  })

  it('does not re-transition duplicate status commands', async () => {
    const { transitionJob } = await import('../../lib/jobs')
    mockDb.job.findMany.mockResolvedValueOnce([makeJob({ status: 'EN_ROUTE' })])

    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('on the way')!,
    })

    expect(result.ok).toBe(true)
    expect(transitionJob).not.toHaveBeenCalled()
    expect(result.ok && result.message).toContain('No duplicate customer notification')
  })

  it('blocks non-linear transitions', async () => {
    mockDb.job.findMany.mockResolvedValueOnce([{ id: 'job-1', status: 'SCHEDULED' }])
    const result = await executeProviderJobCommand({
      phone: '+27111111111',
      command: parseProviderJobCommand('done')!,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('INVALID_COMMAND')
  })

  it('stores completion note/photo and marks started job ready for customer sign-off', async () => {
    const { transitionJob } = await import('../../lib/jobs')
    mockDb.job.findFirst = vi.fn().mockResolvedValue({ id: 'job-1', status: 'STARTED' })

    const result = await completeProviderJobFromWhatsApp({
      phone: '+27111111111',
      jobId: 'job-1',
      completionNote: 'Replaced valve and tested pressure.',
      attachmentId: 'attachment-1',
    })

    expect(result).toMatchObject({ ok: true, duplicate: false })
    expect(mockDb.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { completionNote: 'Replaced valve and tested pressure.' },
    })
    expect(mockDb.attachment.update).toHaveBeenCalledWith({
      where: { id: 'attachment-1' },
      data: {
        jobId: 'job-1',
        label: 'completion_photo',
        caption: 'Replaced valve and tested pressure.',
      },
    })
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      toStatus: 'PENDING_COMPLETION_CONFIRMATION',
      actorRole: 'provider',
    }))
    expect(result.ok && result.message).toContain('Job completed')
  })

  it('does not resend completion notification for duplicate completed job', async () => {
    const { transitionJob } = await import('../../lib/jobs')
    mockDb.job.findFirst = vi.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING_COMPLETION_CONFIRMATION' })

    const result = await completeProviderJobFromWhatsApp({
      phone: '+27111111111',
      jobId: 'job-1',
      completionNote: 'Done',
    })

    expect(result).toMatchObject({ ok: true, duplicate: true })
    expect(mockDb.job.update).not.toHaveBeenCalled()
    expect(transitionJob).not.toHaveBeenCalled()
  })
})
