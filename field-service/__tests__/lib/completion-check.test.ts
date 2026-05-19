import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('../../../lib/db', () => ({
  db: {
    match: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/flags', () => ({
  isEnabled: vi.fn(),
}))

vi.mock('../../../lib/whatsapp', () => ({
  sendCompletionCheckMessage: vi.fn(),
  sendCustomerReviewRequest: vi.fn(),
  sendProviderReviewNudge: vi.fn(),
  sendAdminEscalation: vi.fn(),
  sendText: vi.fn(),
}))

vi.mock('../../../lib/whatsapp-interactive', () => ({
  sendButtons: vi.fn(),
}))

vi.mock('../../../lib/review-access', () => ({
  createReviewUrl: vi.fn(() => 'https://app.plugapro.co.za/review/test-token'),
}))

const { sendPendingCompletionChecks, retryPendingCompletionChecks, handleCompletionCheckYes, handleCompletionCheckNo, handleCompletionCheckWhyRescheduled, handleCompletionCheckWhyNotFinished, handleCompletionCheckWhyDidntShow, flagMatchToAdmin } =
  await import('../../../lib/completion-check')
const { db } = await import('../../../lib/db')
const { isEnabled } = await import('../../../lib/flags')
const { sendCompletionCheckMessage, sendCustomerReviewRequest, sendProviderReviewNudge, sendText } = await import('../../../lib/whatsapp')
const { sendButtons } = await import('../../../lib/whatsapp-interactive')

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
  ;(db.match.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(db.match.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
})

describe('sendPendingCompletionChecks', () => {
  it('returns early with zeros when flag is disabled', async () => {
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const result = await sendPendingCompletionChecks()
    expect(result).toEqual({ sent: 0, skipped: 0, errors: 0 })
    expect(db.match.findMany).not.toHaveBeenCalled()
  })

  it('sends completion check and updates match when flag is enabled', async () => {
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(db.match.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([mockMatch])
    ;(sendCompletionCheckMessage as ReturnType<typeof vi.fn>).mockResolvedValue('msg-id')

    const result = await sendPendingCompletionChecks()
    expect(result.sent).toBe(1)
    expect(result.errors).toBe(0)
    expect(sendCompletionCheckMessage).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'match-1', customerPhone: '+27821111111' })
    )
    expect(db.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'SENT' }) })
    )
  })

  it('increments errors when send fails', async () => {
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(db.match.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([mockMatch])
    ;(sendCompletionCheckMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('WA error'))

    const result = await sendPendingCompletionChecks()
    expect(result.sent).toBe(0)
    expect(result.errors).toBe(1)
  })
})

describe('retryPendingCompletionChecks', () => {
  it('returns early when flag disabled', async () => {
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const result = await retryPendingCompletionChecks()
    expect(result).toEqual({ sent: 0, flagged: 0, errors: 0 })
  })

  it('sends retry and updates match', async () => {
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(db.match.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...mockMatch, completionCheckRetries: 1, completionCheckStatus: 'NO_RESCHEDULED' }])
    ;(sendCompletionCheckMessage as ReturnType<typeof vi.fn>).mockResolvedValue('msg-id')

    const result = await retryPendingCompletionChecks()
    expect(result.sent).toBe(1)
  })
})

describe('handleCompletionCheckYes', () => {
  it('sends review requests and marks reviewRequestSentAt', async () => {
    ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockMatch, reviewRequestSentAt: null })
    ;(sendCustomerReviewRequest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(sendProviderReviewNudge as ReturnType<typeof vi.fn>).mockResolvedValue('msg-id')

    await handleCompletionCheckYes({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(db.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'YES' }) })
    )
    expect(db.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewRequestSentAt: expect.any(Date) }) })
    )
  })

  it('is idempotent — skips if reviewRequestSentAt already set', async () => {
    ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockMatch, reviewRequestSentAt: new Date() })

    await handleCompletionCheckYes({ matchId: 'match-1', customerPhone: '+27821111111' })
    expect(sendCustomerReviewRequest).not.toHaveBeenCalled()
  })

  it('does nothing if match not found', async () => {
    ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await handleCompletionCheckYes({ matchId: 'match-999', customerPhone: '+27821111111' })
    expect(db.match.update).not.toHaveBeenCalled()
  })
})

describe('handleCompletionCheckNo', () => {
  it('sends three-option button message', async () => {
    ;(sendButtons as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    await handleCompletionCheckNo({ matchId: 'match-1', customerPhone: '+27821111111', providerFirstName: 'Lovemore' })
    expect(sendButtons).toHaveBeenCalledWith(
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
    ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ completionCheckRetries: 0 })
    ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('msg-id')

    await handleCompletionCheckWhyRescheduled({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+27821111111' })
    )
    expect(sendButtons).not.toHaveBeenCalled()
    expect(db.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'NO_RESCHEDULED' }) })
    )
  })

  it('flags to admin when retries exhausted', async () => {
    ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ completionCheckRetries: 2 })
    ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('msg-id')

    await handleCompletionCheckWhyRescheduled({ matchId: 'match-1', customerPhone: '+27821111111' })

    expect(db.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'ADMIN_FLAGGED' }) })
    )
    expect(sendText).toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
  })
})

describe('handleCompletionCheckWhyDidntShow', () => {
  it('flags to admin and sends sendText ack (not sendButtons)', async () => {
    ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('msg-id')
    const { sendAdminEscalation } = await import('../../../lib/whatsapp')
    ;(sendAdminEscalation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    await handleCompletionCheckWhyDidntShow({ matchId: 'match-1', customerPhone: '+27821111111', providerName: 'Lovemore' })

    expect(db.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionCheckStatus: 'NO_DIDNT_SHOW' }) })
    )
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+27821111111', text: expect.stringContaining('Lovemore') })
    )
    expect(sendButtons).not.toHaveBeenCalled()
  })
})

describe('flagMatchToAdmin', () => {
  it('sets ADMIN_FLAGGED status', async () => {
    await flagMatchToAdmin('match-1')
    expect(db.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { completionCheckStatus: 'ADMIN_FLAGGED' },
    })
  })
})
