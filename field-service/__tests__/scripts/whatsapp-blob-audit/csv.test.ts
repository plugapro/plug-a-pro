import { describe, it, expect } from 'vitest'
import { buildGapRows, gapRowsToCsv } from '@/scripts/whatsapp-blob-audit/csv'
import type { AttachmentRow, HeadResult, MediaIdIndex } from '@/scripts/whatsapp-blob-audit/types'

const now = new Date('2026-06-06T12:00:00Z')

describe('buildGapRows', () => {
  it('emits one row per dead/error HeadResult and skips alive ones', () => {
    const attachments: AttachmentRow[] = [
      { id: 'a_alive', mediaId: 'm_alive', url: 'u', label: 'evidence', parentKind: 'providerApplication', parentId: 'app_1' },
      { id: 'a_dead', mediaId: 'm_dead', url: 'u', label: 'evidence', parentKind: 'jobRequest', parentId: 'jr_1' },
      { id: 'a_err', mediaId: 'm_err', url: 'u', label: null, parentKind: null, parentId: null },
    ]
    const head: HeadResult[] = [
      { attachmentId: 'a_alive', status: 'alive', httpStatus: 200, errorMessage: null, durationMs: 5 },
      { attachmentId: 'a_dead', status: 'dead', httpStatus: 404, errorMessage: null, durationMs: 5 },
      { attachmentId: 'a_err', status: 'error', httpStatus: null, errorMessage: 'net', durationMs: 5 },
    ]
    const index: MediaIdIndex = new Map([
      ['m_dead', new Date('2026-06-06T08:00:00Z')],
      ['m_err', new Date('2026-05-28T08:00:00Z')],
    ])
    const rows = buildGapRows(attachments, head, index, now)
    expect(rows.map((r) => r.attachmentId).sort()).toEqual(['a_dead', 'a_err'])
    const dead = rows.find((r) => r.attachmentId === 'a_dead')!
    expect(dead.ageBucket).toBe('lt_24h')
    expect(dead.replayable).toBe(true)
    expect(dead.mediaIdSuffix).toBe('m_dead'.slice(-8))
    const err = rows.find((r) => r.attachmentId === 'a_err')!
    expect(err.ageBucket).toBe('gt_7d')
    expect(err.replayable).toBe(false)
  })

  it('marks replayable=false for unknown age (no inbound row found)', () => {
    const rows = buildGapRows(
      [{ id: 'a1', mediaId: 'm1', url: 'u', label: null, parentKind: null, parentId: null }],
      [{ attachmentId: 'a1', status: 'dead', httpStatus: 404, errorMessage: null, durationMs: 5 }],
      new Map(),
      now,
    )
    expect(rows[0].ageBucket).toBe('unknown')
    expect(rows[0].replayable).toBe(false)
  })
})

describe('gapRowsToCsv', () => {
  it('emits header + CSV rows with proper escaping', () => {
    const csv = gapRowsToCsv([
      { attachmentId: 'a1', mediaIdSuffix: 'abc12345', ageBucket: 'lt_24h', parentKind: 'jobRequest', parentId: 'jr_1', label: 'evidence,with,commas', httpStatus: 404, firstSeenAt: '2026-06-06T08:00:00Z', replayable: true, reason: 'dead_blob_within_meta_window' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('attachmentId,mediaIdSuffix,ageBucket,parentKind,parentId,label,httpStatus,firstSeenAt,replayable,reason')
    expect(lines[1]).toContain('"evidence,with,commas"')
    expect(lines[1].startsWith('a1,abc12345,lt_24h,jobRequest,jr_1,')).toBe(true)
  })
})
