/**
 * audit-whatsapp-blob-gaps.ts
 *
 * READ-ONLY audit of Attachment rows whose Vercel Blob URLs no longer resolve.
 * Emits a CSV of dead/error rows with their Meta media-retention age bucket
 * so the operator knows what is still replayable.
 *
 * Usage:
 *   pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out ./recovery [--concurrency 8] [--timeout-ms 5000]
 *
 * Requires:
 *   DATABASE_URL
 *
 * Production-safety: this script never writes to Postgres, Vercel Blob, or
 * Supabase Storage. It issues SELECT queries and HTTP HEAD requests only.
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAttachments, loadMediaIdIndex } from './whatsapp-blob-audit/loader'
import { headCheckAll } from './whatsapp-blob-audit/head-checker'
import { buildGapRows, gapRowsToCsv } from './whatsapp-blob-audit/csv'

type Args = { out: string; concurrency: number; timeoutMs: number }

function parseArgs(argv: string[]): Args {
  let out = './recovery'
  let concurrency = 8
  let timeoutMs = 5000
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    const next = argv[i + 1]
    if (flag === '--out' && next) { out = next; i++ }
    else if (flag === '--concurrency' && next) { concurrency = Number(next); i++ }
    else if (flag === '--timeout-ms' && next) { timeoutMs = Number(next); i++ }
  }
  return { out, concurrency, timeoutMs }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  console.info('[audit] loading attachments and media index...')
  const [attachments, mediaIndex] = await Promise.all([loadAttachments(), loadMediaIdIndex()])
  console.info('[audit] loaded', { attachments: attachments.length, mediaIndex: mediaIndex.size })

  console.info('[audit] head-checking blob URLs', { concurrency: args.concurrency, timeoutMs: args.timeoutMs })
  const headResults = await headCheckAll(attachments, {
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
  })

  const summary = headResults.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] head-check summary', summary)

  const gaps = buildGapRows(attachments, headResults, mediaIndex, new Date())
  mkdirSync(args.out, { recursive: true })
  writeFileSync(join(args.out, 'whatsapp-blob-gaps.csv'), gapRowsToCsv(gaps))
  console.info('[audit] wrote', join(args.out, 'whatsapp-blob-gaps.csv'), { rows: gaps.length })

  const byBucket = gaps.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.ageBucket}/${r.replayable ? 'replayable' : 'expired'}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] gap distribution', byBucket)
}

main().catch((err) => {
  console.error('[audit] failed', err)
  process.exit(1)
})
