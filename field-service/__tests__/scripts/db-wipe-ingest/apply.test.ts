import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IngestPlan } from '@/scripts/db-wipe-ingest/types'

vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    attachment: { count: vi.fn() },
  },
}))

const baseRow = {
  mediaId: 'm1',
  mediaIdSuffix: 'm1',
  messageType: 'image' as const,
  phone: '27111',
  firstSeenAt: '2026-06-06T11:00:00Z',
  ageBucket: '1_to_3d' as const,
  parentKind: 'providerApplication' as const,
  parentId: 'app_1',
  parentConfidence: 'HIGH' as const,
  label: 'evidence',
}

function makePlan(overrides: Partial<IngestPlan> = {}): IngestPlan {
  return {
    version: 1,
    generatedAt: '2026-06-06T12:00:00Z',
    attachmentSnapshot: { totalCount: 5, whatsappCount: 5, maxCreatedAt: '2026-06-06T11:00:00Z' },
    totalCandidates: 1,
    totalMissing: 1,
    planned: 1,
    skipped: 0,
    rows: [baseRow],
    skippedRows: [],
    ...overrides,
  }
}

describe('applyIngestPlan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses to proceed if attachment count dropped below plan snapshot (stale plan)', async () => {
    const { db } = await import('@/lib/db')
    ;(db.attachment.count as ReturnType<typeof vi.fn>).mockResolvedValue(3)
    const { applyIngestPlan } = await import('@/scripts/db-wipe-ingest/apply')
    await expect(applyIngestPlan(makePlan())).rejects.toThrow(/plan stale/)
  })

  it('allows growth in attachment count between plan and apply', async () => {
    const { db } = await import('@/lib/db')
    ;(db.attachment.count as ReturnType<typeof vi.fn>).mockResolvedValue(8)
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    ;(downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ attachmentId: 'a_new' })
    const { applyIngestPlan } = await import('@/scripts/db-wipe-ingest/apply')
    const results = await applyIngestPlan(makePlan())
    expect(results[0].status).toBe('success')
  })

  it('dry-run never calls downloadAndStoreWhatsAppMedia and tags rows DRY_RUN', async () => {
    const { db } = await import('@/lib/db')
    ;(db.attachment.count as ReturnType<typeof vi.fn>).mockResolvedValue(5)
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    const { applyIngestPlan } = await import('@/scripts/db-wipe-ingest/apply')
    const results = await applyIngestPlan(makePlan(), { dryRun: true })
    expect(downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(results[0].status).toBe('skipped')
    expect(results[0].errorCode).toBe('DRY_RUN')
  })

  it('passes providerApplicationId only for providerApplication rows; passes null otherwise', async () => {
    const { db } = await import('@/lib/db')
    ;(db.attachment.count as ReturnType<typeof vi.fn>).mockResolvedValue(5)
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    const mock = downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>
    mock.mockResolvedValue({ attachmentId: 'a_x' })
    const { applyIngestPlan } = await import('@/scripts/db-wipe-ingest/apply')

    await applyIngestPlan(makePlan({
      planned: 2,
      rows: [
        baseRow,
        { ...baseRow, mediaId: 'm2', mediaIdSuffix: 'm2', parentKind: null, parentId: null, parentConfidence: 'NONE' },
      ],
    }))

    expect(mock).toHaveBeenNthCalledWith(1, {
      mediaId: 'm1',
      providerApplicationId: 'app_1',
      label: 'evidence',
    })
    expect(mock).toHaveBeenNthCalledWith(2, {
      mediaId: 'm2',
      providerApplicationId: null,
      label: 'evidence',
    })
  })

  it('captures per-row failure without aborting the batch', async () => {
    const { db } = await import('@/lib/db')
    ;(db.attachment.count as ReturnType<typeof vi.fn>).mockResolvedValue(5)
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    const mock = downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>
    mock.mockRejectedValueOnce(new Error('Meta GET 404'))
    mock.mockResolvedValueOnce({ attachmentId: 'a2' })

    const { applyIngestPlan } = await import('@/scripts/db-wipe-ingest/apply')
    const results = await applyIngestPlan(makePlan({
      planned: 2,
      rows: [baseRow, { ...baseRow, mediaId: 'm2', mediaIdSuffix: 'm2' }],
    }))

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ status: 'failed', mediaId: 'm1' })
    expect(results[0].errorMessage).toMatch(/Meta GET 404/)
    expect(results[1]).toMatchObject({ status: 'success', mediaId: 'm2', attachmentId: 'a2' })
  })
})
