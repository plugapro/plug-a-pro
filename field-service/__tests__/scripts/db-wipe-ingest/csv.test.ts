import { describe, it, expect } from 'vitest'
import { ingestResultsToCsv } from '@/scripts/db-wipe-ingest/csv'

describe('ingestResultsToCsv', () => {
  it('emits header on its own when given an empty list', () => {
    expect(ingestResultsToCsv([])).toBe(
      'mediaIdSuffix,mediaId,status,attachmentId,errorCode,errorMessage,durationMs',
    )
  })

  it('emits header + one row for a success result', () => {
    const csv = ingestResultsToCsv([
      {
        mediaIdSuffix: 'abcd1234',
        mediaId: 'media_abcd1234',
        status: 'success',
        attachmentId: 'a_new_1',
        errorCode: null,
        errorMessage: null,
        durationMs: 184,
      },
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('abcd1234,media_abcd1234,success,a_new_1,,,184')
  })

  it('escapes commas and quotes in error message', () => {
    const csv = ingestResultsToCsv([
      {
        mediaIdSuffix: 'm1',
        mediaId: 'm1',
        status: 'failed',
        attachmentId: null,
        errorCode: 'META_404',
        errorMessage: 'Not found, "no such media"',
        durationMs: 123,
      },
    ])
    const lines = csv.split('\n')
    expect(lines[1]).toContain('"Not found, ""no such media"""')
  })
})
