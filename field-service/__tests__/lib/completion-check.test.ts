import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockIsEnabled, mockSendCompletionCheckMessage, mockSendCustomerReviewRequest, mockSendProviderReviewNudge, mockSendAdminEscalation, mockSendText, mockSendButtons, mockCreateReviewUrl } = vi.hoisted(() => ({
  mockDb: {
    match: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockIsEnabled: vi.fn(),
  mockSendCompletionCheckMessage: vi.fn(),
  mockSendCustomerReviewRequest: vi.fn(),
  mockSendProviderReviewNudge: vi.fn(),
  mockSendAdminEscalation: vi.fn(),
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockCreateReviewUrl: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('../../lib/whatsapp', () => ({
  sendCompletionCheckMessage: mockSendCompletionCheckMessage,
  sendCustomerReviewRequest: mockSendCustomerReviewRequest,
  sendProviderReviewNudge: mockSendProviderReviewNudge,
  sendAdminEscalation: mockSendAdminEscalation,
  sendText: mockSendText,
}))
vi.mock('../../lib/whatsapp-interactive', () => ({ sendButtons: mockSendButtons }))
vi.mock('../../lib/review-access', () => ({ createReviewUrl: mockCreateReviewUrl }))

import {
  sendPendingCompletionChecks,
  retryPendingCompletionChecks,
  handleCompletionCheckYes,
  handleCompletionCheckNo,
  handleCompletionCheckWhyRescheduled,
  handleCompletionCheckWhyNotFinished,
  handleCompletionCheckWhyDidntShow,
  flagMatchToAdmin,
} from '../../lib/completion-check'

const mockMatch = {
  id: 'match-1',
  completionCheckRetries: 0,
  reviewRequestSentAt: null,
  completionCheckStatus: null,
  jobRequest: {
    category: 'Plumbing',
    requestedWindowEnd: new Date(Date.now() - 3 * 864e5),
    customer: { id: 'c-1', name: 'Sarah', phone: '+27821111111' },
  },
  provider: { id: 'p-1', name: 'Lovemore', phone: '+27822222222' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.match.update.mockResolvedValue({})
  mockDb.match.findMany.mockResolvedValue([])
  mockDb.match.findUnique.mockResolvedValue(null)
  mockCreateReviewUrl.mockReturnValue('https://app.plugapro.co.za/review/test-token')
  mockSendCompletionCheckMessage.mockResolvedValue('msg-id')
  mockSendCustomerReviewRequest.mockResolvedValue(undefined)
  mockSendProviderReviewNudge.mockResolvedValue('msg-id')
  mockSendAdminEscalation.mockResolvedValue(undefined)
  mockSendText.mockResolvedValue('msg-id')
  mockSendButtons.mockResolvedValue(undefined)
})

describe('sendPendingCompletionChecks', () => {
  it('returns early with zeros when flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const result = await sendPendingCompletionChecks()
    expect(result).toEqual({ sent: 0, skipped: 0, errors: 0 })
    expect(mockDb.match.findMany).not.toHaveBeenCalled()
  })

  it('sends completion check and updates match when flag is enabled', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockDb.match.findMany.mockResolvedValue([mockMatch])

    const result = await sendPendingCompletionChecks()
    expect(result.sent).toBe(1)
    expect(result.errors).toBe(0)
    expect(mockSendCompletionCheckMessage).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'match-1', customerPhone: '+27821111111' })
    )
    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'SENT' }) })
    )
  })

  it('increments errors when send fails', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockDb.match.findMany.mockResolvedValue([mockMatch])
    mockSendCompletionCheckMessage.mockRejectedValue(new Error('WA error'))

    const result = await sendPendingCompletionChecks()
    expect(result.sent).toBe(0)
    expect(result.errors).toBe(1)
  })
})

describe('retryPendingCompletionChecks', () => {
  it('returns early when flag disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const result = await retryPendingCompletionChecks()
    expect(result).toEqual({ sent: 0, flagged: 0, errors: 0 })
  })

  it('sends retry and updates match', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockDb.match.findMany.mockResolvedValue([{
      ...mockMatch,
      completionCheckRetries: 1,
      completionCheckStatus: 'NO_RESCHEDULED',
    }])

    const result = await retryPendingCompletionChecks()
    expect(result.sent).toBe(1)
    expect(mockSendCompletionCheckMessage).toHaveBeenCalled()
  })
})

describe('handleCompletionCheckYes', () => {
  it('sends review requests and marks reviewRequestSentAt', async () => {
    mockDb.match.findUnique.mockResolvedValue({ ...mockMatch, reviewRequestSentAt: null })

    await handleCompletionCheckYes({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'YES' }) })
    )
    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewRequestSentAt: expect.any(Date) }) })
    )
  })

  it('is idempotent - skips if reviewRequestSentAt already set', async () => {
    mockDb.match.findUnique.mockResolvedValue({ ...mockMatch, reviewRequestSentAt: new Date() })

    await handleCompletionCheckYes({ matchId: 'match-1', customerPhone: '+27821111111' })
    expect(mockSendCustomerReviewRequest).not.toHaveBeenCalled()
  })

  it('does nothing if match not found', async () => {
    mockDb.match.findUnique.mockResolvedValue(null)
    await handleCompletionCheckYes({ matchId: 'match-999', customerPhone: '+27821111111' })
    expect(mockDb.match.update).not.toHaveBeenCalled()
  })
})

describe('handleCompletionCheckNo', () => {
  it('sends three-option button message', async () => {
    await handleCompletionCheckNo({ matchId: 'match-1', customerPhone: '+27821111111', providerFirstName: 'Lovemore' })
    expect(mockSendButtons).toHaveBeenCalledWith(
      '+27821111111',
      expect.stringContaining('Lovemore'),
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining('completion_why_rescheduled_match-1') }),
        expect.objectContaining({ id: expect.stringContaining('completion_why_not_finished_match-1') }),
        expect.objectContaining({ id: expect.stringContaining('completion_why_didnt_show_match-1') }),
      ]),
      undefined,
      expect.any(Object)
    )
  })
})

describe('handleCompletionCheckWhyRescheduled', () => {
  it('acks with sendText (not sendButtons) and sets NO_RESCHEDULED', async () => {
    mockDb.match.findUnique.mockResolvedValue({ completionCheckRetries: 0 })

    await handleCompletionCheckWhyRescheduled({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+27821111111' })
    )
    expect(mockSendButtons).not.toHaveBeenCalled()
    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'NO_RESCHEDULED' }) })
    )
  })

  it('flags to admin when retries exhausted', async () => {
    mockDb.match.findUnique.mockResolvedValue({ completionCheckRetries: 2 })

    await handleCompletionCheckWhyRescheduled({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'ADMIN_FLAGGED' }) })
    )
    expect(mockSendText).toHaveBeenCalled()
    expect(mockSendButtons).not.toHaveBeenCalled()
  })
})

describe('handleCompletionCheckWhyNotFinished', () => {
  it('acks with sendText and sets NO_NOT_FINISHED', async () => {
    mockDb.match.findUnique.mockResolvedValue({ completionCheckRetries: 0 })

    await handleCompletionCheckWhyNotFinished({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({ to: '+27821111111' }))
    expect(mockSendButtons).not.toHaveBeenCalled()
    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'NO_NOT_FINISHED' }) })
    )
  })
})

describe('handleCompletionCheckWhyDidntShow', () => {
  it('flags to admin and sends sendText ack (not sendButtons)', async () => {
    await handleCompletionCheckWhyDidntShow({ matchId: 'match-1', customerPhone: '+27821111111', providerName: 'Lovemore' })

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'NO_DIDNT_SHOW' }) })
    )
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+27821111111', text: expect.stringContaining('Lovemore') })
    )
    expect(mockSendButtons).not.toHaveBeenCalled()
  })
})

describe('flagMatchToAdmin', () => {
  it('sets ADMIN_FLAGGED status', async () => {
    await flagMatchToAdmin('match-1')
    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { completionCheckStatus: 'ADMIN_FLAGGED' },
    })
  })
})
