import type { IngestResult } from './types'

const COLUMNS: Array<keyof IngestResult> = [
  'mediaIdSuffix', 'mediaId', 'status', 'attachmentId', 'errorCode', 'errorMessage', 'durationMs',
]

function escape(value: string | number | boolean | null): string {
  if (value === null) return ''
  const s = String(value)
  const needsQuoting = /[",\n]/.test(s)
  const inner = s.replace(/"/g, '""')
  return needsQuoting ? `"${inner}"` : inner
}

export function ingestResultsToCsv(rows: IngestResult[]): string {
  const header = COLUMNS.join(',')
  const body = rows
    .map((row) => COLUMNS.map((c) => escape((row[c] ?? null) as string | number | boolean | null)).join(','))
    .join('\n')
  return body ? `${header}\n${body}` : header
}
