/**
 * db-wipe-ingest.ts
 *
 * Ingest inbound WhatsApp media that has no matching Attachment row, by
 * calling lib/whatsapp-media.ts's downloadAndStoreWhatsAppMedia. Re-pulls
 * the binary from Meta's media API, uploads to Vercel Blob, INSERTs an
 * Attachment row. Idempotent at the helper level via
 * `uploadedBy = system:whatsapp:<mediaId>`.
 *
 * Subcommands:
 *   plan                  Read-only. Queries DB, classifies missing media,
 *                         writes <out>/ingest-plan.json. No Meta calls, no
 *                         blob writes, no Attachment INSERTs.
 *   apply --confirm       Executes the plan: blob writes, Attachment INSERTs.
 *   apply --dry-run       Walks the plan without calling Meta or writing.
 *
 * Usage:
 *   pnpm tsx scripts/db-wipe-ingest.ts plan [--out ./recovery]
 *   pnpm tsx scripts/db-wipe-ingest.ts apply --confirm [--out ./recovery]
 *   pnpm tsx scripts/db-wipe-ingest.ts apply --dry-run [--out ./recovery]
 *
 * Requires: DATABASE_URL, WHATSAPP_ACCESS_TOKEN, BLOB_READ_WRITE_TOKEN.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'

// Load env files in Next.js-style priority order:
//   .env.production.local > .env.local > .env.production > .env
// First-set wins per key. WHATSAPP_ACCESS_TOKEN lives in
// .env.production.local; without loading it explicitly the helper throws
// WHATSAPP_ACCESS_TOKEN_MISSING. Implemented inline so the script has no
// extra dotenv dependency.
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/^export\s+/, '').trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvFile('.env.production.local')
loadEnvFile('.env.local')
loadEnvFile('.env.production')
loadEnvFile('.env')
import { join } from 'node:path'
import { buildIngestPlan } from './db-wipe-ingest/plan'
import { applyIngestPlan } from './db-wipe-ingest/apply'
import { ingestResultsToCsv } from './db-wipe-ingest/csv'
import type { IngestPlan } from './db-wipe-ingest/types'

type Args = {
  subcommand: 'plan' | 'apply' | 'help'
  out: string
  confirm: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const subcommand = (argv[2] ?? 'help') as Args['subcommand']
  let out = './recovery'
  let confirm = false
  let dryRun = false
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) { out = argv[++i] }
    else if (argv[i] === '--confirm') { confirm = true }
    else if (argv[i] === '--dry-run') { dryRun = true }
  }
  return { subcommand, out, confirm, dryRun }
}

async function runPlan(out: string): Promise<void> {
  console.info('[ingest] building plan...')
  const plan = await buildIngestPlan(new Date())
  mkdirSync(out, { recursive: true })
  const file = join(out, 'ingest-plan.json')
  writeFileSync(file, JSON.stringify(plan, null, 2))
  console.info('[ingest] plan written', {
    file,
    candidates: plan.totalCandidates,
    missing: plan.totalMissing,
    planned: plan.planned,
    skipped: plan.skipped,
  })
  const byConf = plan.rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.parentConfidence] = (acc[r.parentConfidence] ?? 0) + 1
    return acc
  }, {})
  console.info('[ingest] planned confidence distribution', byConf)
  const byType = plan.rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.messageType] = (acc[r.messageType] ?? 0) + 1
    return acc
  }, {})
  console.info('[ingest] planned message-type distribution', byType)
}

async function runApply(out: string, confirm: boolean, dryRun: boolean): Promise<void> {
  if (!confirm && !dryRun) {
    console.error('[ingest] apply requires --confirm to write, or --dry-run to simulate')
    process.exit(2)
  }
  const planPath = join(out, 'ingest-plan.json')
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as IngestPlan
  console.info('[ingest] loaded plan', {
    file: planPath,
    planned: plan.planned,
    dryRun,
    confirm,
  })

  const results = await applyIngestPlan(plan, {
    dryRun,
    onProgress: (r, idx, total) => {
      if (idx % 10 === 0 || r.status !== 'success') {
        console.info(`[ingest] ${idx}/${total}`, {
          mediaIdSuffix: r.mediaIdSuffix,
          status: r.status,
          errorCode: r.errorCode,
        })
      }
    },
  })

  mkdirSync(out, { recursive: true })
  const resultsCsv = join(out, 'ingest-results.csv')
  writeFileSync(resultsCsv, ingestResultsToCsv(results))

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  console.info('[ingest] done', { resultsCsv, ...summary })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  switch (args.subcommand) {
    case 'plan':
      await runPlan(args.out)
      return
    case 'apply':
      await runApply(args.out, args.confirm, args.dryRun)
      return
    default:
      console.info(`Usage:
  pnpm tsx scripts/db-wipe-ingest.ts plan [--out ./recovery]
  pnpm tsx scripts/db-wipe-ingest.ts apply --confirm [--out ./recovery]
  pnpm tsx scripts/db-wipe-ingest.ts apply --dry-run [--out ./recovery]`)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('[ingest] failed', err)
  process.exit(1)
})
