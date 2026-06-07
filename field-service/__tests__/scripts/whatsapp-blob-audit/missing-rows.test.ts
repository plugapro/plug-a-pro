import { describe, it, expect } from 'vitest'
import { findMissingRows, missingRowsToCsv } from '@/scripts/whatsapp-blob-audit/missing-rows'
import type { AttachmentRow, InboundMediaCandidate, PhoneParentHints } from '@/scripts/whatsapp-blob-audit/types'

const now = new Date('2026-06-06T12:00:00Z')

describe('findMissingRows', () => {
  it('returns one MissingRowGap per inbound media whose mediaId is not present in any Attachment.uploadedBy', () => {
    const candidates: InboundMediaCandidate[] = [
      { mediaId: 'm1', phone: '+27111', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') },
      { mediaId: 'm2', phone: '+27222', messageType: 'document', firstSeenAt: new Date('2026-06-04T13:00:00Z') },
      // 35 days before 'now' so MetaAgeBucket classifies as gt_30d (past retention)
      { mediaId: 'm3', phone: '+27333', messageType: 'image', firstSeenAt: new Date('2026-05-02T11:00:00Z') },
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
    expect(byId['m3'].ageBucket).toBe('gt_30d')
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

  it('emits empty parent-hint columns when no hints are supplied', () => {
    const gaps = findMissingRows(
      [{ mediaId: 'm1', phone: '+27', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') }],
      [],
      now,
    )
    expect(gaps[0].candidateParentKinds).toBe('')
    expect(gaps[0].candidateParentIds).toBe('')
    expect(gaps[0].reason).toBe('inbound_media_without_attachment_no_parent_hint')
  })

  it('joins parent hints when supplied and switches reason to the with_parent_hint variant', () => {
    // PhoneParentHints is keyed by normalised phone (no leading +).
    const hints: PhoneParentHints = new Map([
      ['27222', { providerApplicationIds: ['app_1', 'app_2'], jobRequestIds: ['jr_9'] }],
    ])
    const gaps = findMissingRows(
      [{ mediaId: 'm2', phone: '+27222', messageType: 'document', firstSeenAt: new Date('2026-06-04T13:00:00Z') }],
      [],
      now,
      hints,
    )
    expect(gaps[0].candidateParentKinds).toBe('providerApplication,jobRequest')
    expect(gaps[0].candidateParentIds).toBe('pa:app_1,pa:app_2,jr:jr_9')
    expect(gaps[0].reason).toBe('inbound_media_without_attachment_with_parent_hint')
  })

  it('resolves the hint regardless of whether the candidate phone has a leading + while the hint key does not', () => {
    // Inbound phone is the raw digits; PhoneParentHints is keyed by normalised
    // phone (no leading +). The lookup must find the entry either way.
    const hints: PhoneParentHints = new Map([
      ['27222', { providerApplicationIds: ['app_norm'], jobRequestIds: [] }],
    ])
    const gapsPlus = findMissingRows(
      [{ mediaId: 'mP', phone: '+27222', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') }],
      [],
      now,
      hints,
    )
    const gapsBare = findMissingRows(
      [{ mediaId: 'mB', phone: '27222', messageType: 'image', firstSeenAt: new Date('2026-06-06T11:00:00Z') }],
      [],
      now,
      hints,
    )
    expect(gapsPlus[0].candidateParentIds).toBe('pa:app_norm')
    expect(gapsBare[0].candidateParentIds).toBe('pa:app_norm')
  })

  it('does not switch reason to with_parent_hint when bucket is beyond_meta_window even if hint exists', () => {
    const hints: PhoneParentHints = new Map([
      ['27333', { providerApplicationIds: ['app_old'], jobRequestIds: [] }],
    ])
    const gaps = findMissingRows(
      // 35 days before 'now' (2026-06-06T12:00:00Z) -> beyond Meta's 30-day window
      [{ mediaId: 'm_old', phone: '+27333', messageType: 'image', firstSeenAt: new Date('2026-05-02T11:00:00Z') }],
      [],
      now,
      hints,
    )
    expect(gaps[0].ageBucket).toBe('gt_30d')
    expect(gaps[0].candidateParentKinds).toBe('providerApplication')
    expect(gaps[0].reason).toBe('inbound_media_without_attachment_beyond_meta_window')
  })
})

describe('missingRowsToCsv', () => {
  it('emits header + rows with escaping and redacts phone plus FK IDs by default', () => {
    const csv = missingRowsToCsv([
      {
        mediaIdSuffix: 'abcd1234', messageType: 'image', phone: '+27821234567',
        ageBucket: 'lt_24h', firstSeenAt: '2026-06-06T11:00:00Z', replayable: true,
        candidateParentKinds: 'providerApplication', candidateParentIds: 'pa:provider_application_1234567890abcdef',
        reason: 'inbound_media_without_attachment_with_parent_hint',
      },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('mediaIdSuffix,messageType,phone,ageBucket,firstSeenAt,replayable,candidateParentKinds,candidateParentIds,reason')
    expect(lines[1]).toContain('...4567')
    expect(lines[1]).not.toContain('+27821234567')
    expect(lines[1]).toContain('pa:...90abcdef')
    expect(lines[1]).not.toContain('provider_application_1234567890abcdef')
    expect(lines[1].endsWith(',true,providerApplication,pa:...90abcdef,inbound_media_without_attachment_with_parent_hint')).toBe(true)
  })

  it('can include full phone and FK IDs only when explicitly requested', () => {
    const csv = missingRowsToCsv([
      {
        mediaIdSuffix: 'abcd1234', messageType: 'image', phone: '+27821234567',
        ageBucket: 'lt_24h', firstSeenAt: '2026-06-06T11:00:00Z', replayable: true,
        candidateParentKinds: 'providerApplication', candidateParentIds: 'pa:provider_application_1234567890abcdef',
        reason: 'inbound_media_without_attachment_with_parent_hint',
      },
    ], { includeSensitive: true })
    expect(csv).toContain('+27821234567')
    expect(csv).toContain('pa:provider_application_1234567890abcdef')
  })
})
