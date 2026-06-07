import { describe, it, expect } from 'vitest'
import { findMissingRows, missingRowsToCsv } from '@/scripts/whatsapp-blob-audit/missing-rows'
import type { AttachmentRow, InboundMediaCandidate } from '@/scripts/whatsapp-blob-audit/types'

const now = new Date('2026-06-06T12:00:00Z')

describe('findMissingRows', () => {
  it('returns one MissingRowGap per inbound media whose mediaId is not present in any Attachment.uploadedBy', () => {
    const candidates: InboundMediaCandidate[] = [
      { mediaId: 'm1', phone: '+27111', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { mediaId: 'm2', phone: '+27222', messageType: 'document', firstSeenAt: new Date('2026-06-04T13:00:00Z') },
      { mediaId: 'm3', phone: '+27333', messageType: 'image', firstSeenAt: new Date('2026-05-28T11:00:00Z') },
    ]
    const attachments: AttachmentRow[] = [
      { id: 'a_m1', mediaId: 'm1', url: 'u', label: 'evidence', parentKind: 'providerApplication', parentId: 'app_1' },
    ]
    const gaps = findMissingRows(candidates, attachments, now)
    const byId = Object.fromEntries(gaps.map((g) => [g.mediaIdSuffix, g]))
    expect(gaps).toHaveLength(2)
    expect(byId['m2'].ageBucket).toBe('1_to_3d')
    expect(byId['m2'].replayable).toBe(true)
    expect(byId['m2'].phone).toBe('+27222')
    expect(byId['m2'].messageType).toBe('document')
    expect(byId['m3'].ageBucket).toBe('gt_7d')
    expect(byId['m3'].replayable).toBe(false)
  })

  it('returns empty when every candidate is already present as an Attachment', () => {
    const candidates: InboundMediaCandidate[] = [
      { mediaId: 'm1', phone: '+27', messageType: 'image', firstSeenAt: new Date() },
    ]
    const attachments: AttachmentRow[] = [
      { id: 'a1', mediaId: 'm1', url: 'u', label: null, parentKind: null, parentId: null },
    ]
    const gaps = findMissingRows(candidates, attachments, now)
    expect(gaps).toEqual([])
  })

  it('exposes only the last 8 chars of the media ID in mediaIdSuffix', () => {
    const candidates: InboundMediaCandidate[] = [
      { mediaId: 'verylongmediaid_abcdef12', phone: '+27', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
    ]
    const gaps = findMissingRows(candidates, [], now)
    expect(gaps[0].mediaIdSuffix).toBe('abcdef12')
    // sanity: ensure we did NOT leak the full mediaId
    expect(gaps[0].mediaIdSuffix.length).toBeLessThan('verylongmediaid_abcdef12'.length)
  })
})

describe('missingRowsToCsv', () => {
  it('emits header + rows with escaping; replayable as true/false', () => {
    const csv = missingRowsToCsv([
      { mediaIdSuffix: 'abcd1234', messageType: 'image', phone: '+27,quote', ageBucket: 'lt_24h', firstSeenAt: '2026-06-06T11:00:00Z', replayable: true, reason: 'inbound_media_without_attachment_within_meta_window' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('mediaIdSuffix,messageType,phone,ageBucket,firstSeenAt,replayable,reason')
    expect(lines[1]).toContain('"+27,quote"')
    expect(lines[1].endsWith(',true,inbound_media_without_attachment_within_meta_window')).toBe(true)
  })
})
