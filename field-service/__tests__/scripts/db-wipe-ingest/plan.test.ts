import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { $queryRawUnsafe: vi.fn() },
}))

vi.mock('@/scripts/whatsapp-blob-audit/loader', () => ({
  loadAttachments: vi.fn(),
  loadInboundMediaCandidates: vi.fn(),
  loadPhoneParentHints: vi.fn(),
  normalizePhoneKey: (p: string) => (p.startsWith('+') ? p.slice(1) : p),
}))

describe('buildIngestPlan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies missing media by parent confidence, skips gt_30d, includes attachment snapshot', async () => {
    const { db } = await import('@/lib/db')
    const { loadAttachments, loadInboundMediaCandidates, loadPhoneParentHints } = await import(
      '@/scripts/whatsapp-blob-audit/loader'
    )
    const mock = db.$queryRawUnsafe as ReturnType<typeof vi.fn>
    mock.mockResolvedValueOnce([
      { total: BigInt(5), wa: BigInt(5), max_at: new Date('2026-06-06T18:18:20.157Z') },
    ])
    ;(loadAttachments as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a_have', mediaId: 'already_have', url: 'u', label: 'evidence', parentKind: 'providerApplication', parentId: 'app_have' },
    ])
    ;(loadInboundMediaCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { mediaId: 'already_have', phone: '27111', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { mediaId: 'single_pa',    phone: '27222', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { mediaId: 'multi_pa',     phone: '27333', messageType: 'document', firstSeenAt: new Date('2026-06-04T11:00:00Z') },
      { mediaId: 'no_pa',        phone: '27444', messageType: 'image', firstSeenAt: new Date('2026-06-02T11:00:00Z') },
      // 35d old -> gt_30d, skipped
      { mediaId: 'too_old',      phone: '27555', messageType: 'image', firstSeenAt: new Date('2026-05-02T11:00:00Z') },
    ])
    ;(loadPhoneParentHints as ReturnType<typeof vi.fn>).mockResolvedValue(new Map([
      ['27222', { providerApplicationIds: ['app_single'], jobRequestIds: [] }],
      ['27333', { providerApplicationIds: ['app_a', 'app_b'], jobRequestIds: ['jr_x'] }],
    ]))

    const { buildIngestPlan } = await import('@/scripts/db-wipe-ingest/plan')
    const plan = await buildIngestPlan(new Date('2026-06-06T12:00:00Z'))

    expect(plan.attachmentSnapshot).toEqual({
      totalCount: 5,
      whatsappCount: 5,
      maxCreatedAt: '2026-06-06T18:18:20.157Z',
    })
    expect(plan.totalCandidates).toBe(5)
    expect(plan.totalMissing).toBe(4) // already_have excluded
    expect(plan.planned).toBe(3) // single_pa, multi_pa, no_pa
    expect(plan.skipped).toBe(1) // too_old

    const byMedia = Object.fromEntries(plan.rows.map((r) => [r.mediaId, r]))
    expect(byMedia.single_pa.parentConfidence).toBe('HIGH')
    expect(byMedia.single_pa.parentId).toBe('app_single')
    expect(byMedia.single_pa.parentKind).toBe('providerApplication')
    expect(byMedia.multi_pa.parentConfidence).toBe('MEDIUM')
    expect(byMedia.multi_pa.parentId).toBe('app_a') // first in the candidate list
    expect(byMedia.no_pa.parentConfidence).toBe('NONE')
    expect(byMedia.no_pa.parentId).toBeNull()
    expect(byMedia.no_pa.parentKind).toBeNull()

    expect(plan.skippedRows[0].mediaId).toBe('too_old')
    expect(plan.skippedRows[0].ageBucket).toBe('gt_30d')
    expect(plan.version).toBe(1)
  })

  it('plan rows expose only an 8-char media suffix; they keep the full id for the apply step', async () => {
    const { db } = await import('@/lib/db')
    const { loadAttachments, loadInboundMediaCandidates, loadPhoneParentHints } = await import(
      '@/scripts/whatsapp-blob-audit/loader'
    )
    ;(db.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { total: BigInt(0), wa: BigInt(0), max_at: null },
    ])
    ;(loadAttachments as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(loadInboundMediaCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { mediaId: 'verylongmediaid_abcdef12', phone: '27', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
    ])
    ;(loadPhoneParentHints as ReturnType<typeof vi.fn>).mockResolvedValue(new Map())

    const { buildIngestPlan } = await import('@/scripts/db-wipe-ingest/plan')
    const plan = await buildIngestPlan(new Date('2026-06-06T12:00:00Z'))

    expect(plan.rows[0].mediaIdSuffix).toBe('abcdef12')
    expect(plan.rows[0].mediaId).toBe('verylongmediaid_abcdef12')
  })
})
