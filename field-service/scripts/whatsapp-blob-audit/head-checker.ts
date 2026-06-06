import type { AttachmentRow, HeadResult } from './types'

export async function headCheckAll(
  rows: AttachmentRow[],
  opts: { fetcher?: typeof fetch; concurrency?: number; timeoutMs?: number } = {},
): Promise<HeadResult[]> {
  const fetcher = opts.fetcher ?? fetch
  const concurrency = opts.concurrency ?? 8
  const timeoutMs = opts.timeoutMs ?? 5000

  const results: HeadResult[] = new Array(rows.length)
  let next = 0

  async function worker(): Promise<void> {
    while (next < rows.length) {
      const i = next++
      const row = rows[i]
      const start = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetcher(row.url, { method: 'HEAD', signal: controller.signal })
        const httpStatus = res.status
        results[i] = {
          attachmentId: row.id,
          status: res.ok ? 'alive' : 'dead',
          httpStatus,
          errorMessage: null,
          durationMs: Date.now() - start,
        }
      } catch (err: unknown) {
        results[i] = {
          attachmentId: row.id,
          status: 'error',
          httpStatus: null,
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        }
      } finally {
        clearTimeout(timer)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, () => worker())
  await Promise.all(workers)
  return results
}
