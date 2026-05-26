#!/usr/bin/env tsx
/**
 * Generate a batch of single-use pilot voucher codes and export them as CSV or xlsx.
 *
 * Usage:
 *   cd field-service
 *   npx tsx scripts/generate-vouchers.ts \
 *     --count 100 \
 *     --campaign PILOT_PROVIDER_FLYER \
 *     --name "Pilot Provider Flyer — May 2026" \
 *     --admin-id <AdminUser.id> \
 *     --format xlsx \
 *     --out vouchers.xlsx
 *
 * The output file contains raw codes for printing. Codes are hashed before DB insert.
 * The raw codes are NOT stored in the database.
 *
 * Ordering invariant: the output file is fully written and flushed to disk BEFORE
 * the DB transaction runs. If file writing fails, no DB rows are created. If the DB
 * transaction fails, the file is deleted to avoid leaving plaintext codes whose
 * hashes don't exist in the DB.
 *
 * SECURITY: Treat the output file as sensitive — it contains raw codes.
 * Delete the file after printing. Do not commit it to git.
 */

import { parseArgs } from 'node:util'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Workbook } from 'exceljs'
import { db } from '../lib/db'
import { generateVoucherCode, voucherCodeToHash } from '../lib/vouchers'

// 9 = A4 in the OOXML pageSetup spec. exceljs ships a PaperSize enum in its .d.ts
// but does NOT export it at runtime, so we keep the magic number with a name.
const PAPER_SIZE_A4 = 9

// Excel forbids these characters in worksheet names.
const EXCEL_FORBIDDEN_SHEET_CHARS = /[\\/?*[\]:]/g

const HELP_TEXT = `Generate single-use voucher codes.

Required:
  --admin-id <id>          AdminUser.id to record as batch creator

Optional:
  --count <n>              Number of codes to generate (default 100, max 10000)
  --campaign <code>        Campaign code (default PILOT_PROVIDER_FLYER)
  --name <name>            Batch display name (default "Pilot Provider Flyer")
  --expires-days <n>       Days until expiry (default no expiry, max 3650)
  --format csv|xlsx        Output format (default csv)
  --out <path>             Output file path (default vouchers.csv)
  --help                   Show this help and exit
`

const { values } = parseArgs({
  options: {
    count:           { type: 'string', default: '100' },
    campaign:        { type: 'string', default: 'PILOT_PROVIDER_FLYER' },
    name:            { type: 'string', default: 'Pilot Provider Flyer' },
    'admin-id':      { type: 'string' },
    out:             { type: 'string', default: 'vouchers.csv' },
    'expires-days':  { type: 'string' },
    format:          { type: 'string', default: 'csv' },
    help:            { type: 'boolean', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log(HELP_TEXT)
  process.exit(0)
}

const count = parseInt(values.count ?? '100', 10)
const campaignCode = values.campaign ?? 'PILOT_PROVIDER_FLYER'
const batchName = values.name ?? 'Pilot Provider Flyer'
const adminId = values['admin-id'] ?? ''
const outFile = values.out ?? 'vouchers.csv'
const expiresDays = values['expires-days'] ? parseInt(values['expires-days'], 10) : null
const format = (values.format ?? 'csv').toLowerCase()

if (!adminId) {
  console.error('Error: --admin-id is required. Find your AdminUser.id via the admin panel or DB.')
  process.exit(1)
}

if (format !== 'csv' && format !== 'xlsx') {
  console.error(`Error: --format must be "csv" or "xlsx" (got "${format}")`)
  process.exit(1)
}

if (!Number.isInteger(count) || count <= 0 || count > 10_000) {
  console.error(`Error: --count must be a positive integer between 1 and 10000 (got "${values.count}")`)
  process.exit(1)
}

if (expiresDays !== null && (!Number.isInteger(expiresDays) || expiresDays <= 0 || expiresDays > 3650)) {
  console.error(`Error: --expires-days must be a positive integer between 1 and 3650 (got "${values['expires-days']}")`)
  process.exit(1)
}

const expiresAt = expiresDays
  ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000)
  : null

async function writeCsv(rawCodes: string[], expiresIso: string, createdAt: string): Promise<void> {
  const csvQuote = (v: string) => `"${v.replace(/"/g, '""')}"`
  const out = createWriteStream(outFile)
  await new Promise<void>((resolve, reject) => {
    out.on('error', reject)
    out.on('finish', resolve)
    out.write('code,campaign_name,credit_amount,expires_at,created_at\n')
    for (const code of rawCodes) {
      out.write(`${csvQuote(code)},${csvQuote(campaignCode)},1,${csvQuote(expiresIso)},${csvQuote(createdAt)}\n`)
    }
    out.end()
  })
}

async function writeXlsx(rawCodes: string[], expiresDate: string): Promise<void> {
  const workbook = new Workbook()
  workbook.creator = 'Plug A Pro voucher generator'
  workbook.created = new Date()

  // Sanitise: strip Excel-forbidden chars and clamp to 31 chars.
  const safeSheetName = campaignCode.slice(0, 31).replace(EXCEL_FORBIDDEN_SHEET_CHARS, '_') || 'Vouchers'

  const sheet = workbook.addWorksheet(safeSheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: PAPER_SIZE_A4, orientation: 'portrait', fitToPage: true },
  })

  sheet.columns = [
    { header: '#', key: 'index', width: 6 },
    { header: 'Code', key: 'code', width: 22 },
    { header: 'Expires', key: 'expires', width: 14 },
  ]

  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).alignment = { vertical: 'middle' }

  rawCodes.forEach((code, i) => {
    const row = sheet.addRow({ index: i + 1, code, expires: expiresDate || '—' })
    row.getCell('code').font = { name: 'Menlo', size: 12, bold: true }
  })

  sheet.autoFilter = { from: 'A1', to: `C${rawCodes.length + 1}` }
  await workbook.xlsx.writeFile(outFile)
}

async function main() {
  console.log(`Generating ${count} vouchers for campaign "${campaignCode}"…`)

  // Generate all codes upfront — pure CPU, no side effects.
  const rawCodes: string[] = []
  const codeHashes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = generateVoucherCode()
    rawCodes.push(code)
    codeHashes.push(voucherCodeToHash(code))
  }

  // Within the in-memory codes there must be no duplicates (would violate
  // codeHash @unique at insert time). With ~30^8 keyspace this is extremely
  // rare but cheap to guard against.
  const uniqueHashCount = new Set(codeHashes).size
  if (uniqueHashCount !== codeHashes.length) {
    console.error(`Error: generated ${codeHashes.length - uniqueHashCount} duplicate code(s). Rerun.`)
    process.exit(1)
  }

  const createdAt = new Date().toISOString()
  const expiresIso = expiresAt?.toISOString() ?? ''
  const expiresDate = expiresAt ? expiresAt.toISOString().slice(0, 10) : ''

  // Write the output file FIRST. If this fails, no DB rows are inserted and
  // the operator can investigate without an orphan batch in production.
  console.log(`Writing ${format} output to ${outFile}…`)
  try {
    if (format === 'csv') {
      await writeCsv(rawCodes, expiresIso, createdAt)
    } else {
      await writeXlsx(rawCodes, expiresDate)
    }
  } catch (fileErr) {
    console.error('File write failed before DB insert — no DB changes made.')
    throw fileErr
  }

  // File is on disk. Now commit the DB rows. If this fails, the file contains
  // codes whose hashes don't exist in the DB → unredeemable plaintext. We
  // delete it to avoid confusing the operator.
  try {
    await db.$transaction(async (tx) => {
      const batch = await tx.voucherBatch.create({
        data: {
          name: batchName,
          campaignCode,
          creditAmount: 1,
          count,
          expiresAt,
          createdById: adminId,
        },
      })

      await tx.promoVoucher.createMany({
        data: codeHashes.map((codeHash) => ({
          codeHash,
          batchId: batch.id,
          creditAmount: 1,
          maxRedemptions: 1,
          expiresAt,
        })),
      })

      console.log(`Batch ID: ${batch.id}`)
    })
  } catch (dbErr) {
    console.error('DB transaction failed — deleting orphan output file to avoid unredeemable plaintext.')
    await unlink(outFile).catch(() => { /* file may not exist; ignore */ })
    throw dbErr
  }

  console.log(`✅ ${count} vouchers created. Raw codes exported to ${outFile}`)
  console.log(`IMPORTANT: Treat ${outFile} as sensitive — delete after printing.`)
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  await db.$disconnect().catch(() => { /* connection may not be open */ })
  process.exit(1)
})
