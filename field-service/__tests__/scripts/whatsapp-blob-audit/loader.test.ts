import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAttachments, loadMediaIdIndex } from '@/scripts/whatsapp-blob-audit/loader'

vi.mock('@/lib/db', () => ({
  db: { $queryRawUnsafe: vi.fn() },
}))

describe('loadAttachments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('SELECTs Attachment rows whose uploadedBy starts with system:whatsapp:', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', uploadedBy: 'system:whatsapp:abc12345', url: 'https://blob/x', label: 'evidence', providerApplicationId: 'app_1', jobRequestId: null, jobId: null, inspectionSlotId: null },
    ])
    const rows = await loadAttachments()
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringMatching(/SELECT/i))
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"uploadedBy" LIKE 'system:whatsapp:%'`))
    expect(db.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE|DELETE|INSERT/i))
    expect(rows[0]).toEqual({
      id: 'a1', mediaId: 'abc12345', url: 'https://blob/x', label: 'evidence',
      parentKind: 'providerApplication', parentId: 'app_1',
    })
  })

  it('derives the correct parentKind from whichever FK is populated', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a2', uploadedBy: 'system:whatsapp:m2', url: 'u', label: null, providerApplicationId: null, jobRequestId: 'jr_1', jobId: null, inspectionSlotId: null },
      { id: 'a3', uploadedBy: 'system:whatsapp:m3', url: 'u', label: null, providerApplicationId: null, jobRequestId: null, jobId: 'job_1', inspectionSlotId: null },
      { id: 'a4', uploadedBy: 'system:whatsapp:m4', url: 'u', label: null, providerApplicationId: null, jobRequestId: null, jobId: null, inspectionSlotId: 'is_1' },
      { id: 'a5', uploadedBy: 'system:whatsapp:m5', url: 'u', label: null, providerApplicationId: null, jobRequestId: null, jobId: null, inspectionSlotId: null },
    ])
    const rows = await loadAttachments()
    expect(rows.map((r) => r.parentKind)).toEqual(['jobRequest', 'job', 'inspectionSlot', null])
  })
})

describe('loadMediaIdIndex', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds a mediaId → firstSeenAt map from inbound_whatsapp_messages', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { media_id: 'm1', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { media_id: 'm2', firstSeenAt: new Date('2026-06-02T11:00:00Z') },
    ])
    const index = await loadMediaIdIndex()
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"messageType" IN ('image','document','video')`))
    expect(db.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE|DELETE|INSERT/i))
    expect(index.get('m1')?.toISOString()).toBe('2026-06-06T11:00:00.000Z')
    expect(index.size).toBe(2)
  })
})

describe('loadInboundMediaCandidates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns one InboundMediaCandidate per inbound_whatsapp_messages row with a non-null media_id', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([
      { media_id: 'm1', phone: '+27111', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { media_id: 'm2', phone: '+27222', messageType: 'document', firstSeenAt: new Date('2026-06-04T11:00:00Z') },
      { media_id: null, phone: '+27333', messageType: 'image', firstSeenAt: new Date('2026-06-06T10:00:00Z') },
    ])
    const { loadInboundMediaCandidates } = await import('@/scripts/whatsapp-blob-audit/loader')
    const rows = await loadInboundMediaCandidates()
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringMatching(/SELECT/i))
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining(`"messageType" IN ('image','document','video')`))
    expect(db.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE|DELETE|INSERT/i))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ mediaId: 'm1', phone: '+27111', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') })
    expect(rows[1].mediaId).toBe('m2')
  })
})

describe('loadPhoneParentHints', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an empty map when phones is empty (no DB round-trip)', async () => {
    const { db } = await import('@/lib/db')
    const { loadPhoneParentHints } = await import('@/scripts/whatsapp-blob-audit/loader')
    const hints = await loadPhoneParentHints([])
    expect(hints.size).toBe(0)
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('aggregates ProviderApplication + JobRequest IDs keyed by normalised phone (no leading +)', async () => {
    const { db } = await import('@/lib/db')
    const mock = db.$queryRawUnsafe as ReturnType<typeof vi.fn>
    // First call: provider_applications (stored with leading +)
    mock.mockResolvedValueOnce([
      { id: 'app_1', phone: '+27111' },
      { id: 'app_2', phone: '+27111' },
      { id: 'app_3', phone: '+27222' },
    ])
    // Second call: job_requests JOIN customers (stored with leading +)
    mock.mockResolvedValueOnce([
      { id: 'jr_9', phone: '+27111' },
      { id: 'jr_10', phone: '+27333' },
    ])
    const { loadPhoneParentHints } = await import('@/scripts/whatsapp-blob-audit/loader')
    // Inbound phones (no +) — and a duplicate to verify de-dup
    const hints = await loadPhoneParentHints(['27111', '27222', '27333', '27111'])

    expect(mock).toHaveBeenCalledTimes(2)
    // SQL must strip leading + on the stored side so both formats line up
    expect(mock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/regexp_replace\(phone,\s*'\^\\\+'/),
      expect.arrayContaining(['27111', '27222', '27333']),
    )
    expect(mock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('job_requests'),
      expect.arrayContaining(['27111', '27222', '27333']),
    )
    expect(mock).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE|DELETE|INSERT/i))

    // Map keys are normalised (no leading +) regardless of how the DB stored them.
    expect(hints.get('27111')).toEqual({ providerApplicationIds: ['app_1', 'app_2'], jobRequestIds: ['jr_9'] })
    expect(hints.get('27222')).toEqual({ providerApplicationIds: ['app_3'], jobRequestIds: [] })
    expect(hints.get('27333')).toEqual({ providerApplicationIds: [], jobRequestIds: ['jr_10'] })
    expect(hints.get('+27111')).toBeUndefined()
  })
})
