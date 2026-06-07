/**
 * audit-whatsapp-blob-gaps.ts
 *
 * READ-ONLY audit of Attachment rows whose Vercel Blob URLs no longer resolve,
 * PLUS inbound WhatsApp media that has no Attachment row at all.
 *
 * Emits two CSVs under <out>/:
 *   - whatsapp-blob-gaps.csv          (dead-blob gaps; rows the operator already had)
 *   - missing-attachment-rows.csv     (inbound media never persisted as Attachment)
 *
 * Usage:
 *   pnpm tsx scripts/audit-whatsapp-blob-gaps.ts --out ./recovery [--concurrency 8] [--timeout-ms 5000]
 *
 * Requires:
 *   DATABASE_URL
 *
 * Production-safety: never writes to Postgres, Vercel Blob, or Supabase Storage.
 * SELECT queries and HTTP HEAD requests only.
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAttachments, loadInboundMediaCandidates, loadPhoneParentHints } from './whatsapp-blob-audit/loader'
import { headCheckAll } from './whatsapp-blob-audit/head-checker'
import { buildGapRows, gapRowsToCsv } from './whatsapp-blob-audit/csv'
import { findMissingRows, missingRowsToCsv } from './whatsapp-blob-audit/missing-rows'
import type { MediaIdIndex } from './whatsapp-blob-audit/types'

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
  const now = new Date()

  console.info('[audit] loading attachments and inbound media candidates...')
  const [attachments, candidates] = await Promise.all([loadAttachments(), loadInboundMediaCandidates()])
  console.info('[audit] loaded', { attachments: attachments.length, candidates: candidates.length })

  // Derive MediaIdIndex from candidates — saves one round-trip vs. loadMediaIdIndex().
  const mediaIndex: MediaIdIndex = new Map(candidates.map((c) => [c.mediaId, c.firstSeenAt]))

  console.info('[audit] head-checking blob URLs', { concurrency: args.concurrency, timeoutMs: args.timeoutMs })
  const headResults = await headCheckAll(attachments, {
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
  })

  const headSummary = headResults.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] head-check summary', headSummary)

  mkdirSync(args.out, { recursive: true })

  const gaps = buildGapRows(attachments, headResults, mediaIndex, now)
  writeFileSync(join(args.out, 'whatsapp-blob-gaps.csv'), gapRowsToCsv(gaps))
  console.info('[audit] wrote', join(args.out, 'whatsapp-blob-gaps.csv'), { rows: gaps.length })

  const gapsByBucket = gaps.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.ageBucket}/${r.replayable ? 'replayable' : 'expired'}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] dead-blob gap distribution', gapsByBucket)

  // FK-resolution hint pass: look up which ProviderApplication / JobRequest
  // rows exist for each phone in the missing candidate set. Read-only, two
  // extra SELECTs bounded by ANY($1::text[]).
  const missingCandidatePhones = candidates
    .filter((c) => !new Set(attachments.map((a) => a.mediaId)).has(c.mediaId))
    .map((c) => c.phone)
  console.info('[audit] loading FK-resolution hints', { uniquePhones: new Set(missingCandidatePhones).size })
  const phoneHints = await loadPhoneParentHints(missingCandidatePhones)

  const missing = findMissingRows(candidates, attachments, now, phoneHints)
  writeFileSync(join(args.out, 'missing-attachment-rows.csv'), missingRowsToCsv(missing))
  console.info('[audit] wrote', join(args.out, 'missing-attachment-rows.csv'), { rows: missing.length })

  const missingByBucket = missing.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.ageBucket}/${r.replayable ? 'replayable' : 'expired'}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  console.info('[audit] missing-row gap distribution', missingByBucket)
}

main().catch((err) => {
  console.error('[audit] failed', err)
  process.exit(1)
})
