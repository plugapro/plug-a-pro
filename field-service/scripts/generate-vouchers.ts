#!/usr/bin/env tsx
/**
 * Generate a batch of single-use pilot voucher codes and export them as CSV.
 *
 * Usage:
 *   cd field-service
 *   npx tsx scripts/generate-vouchers.ts \
 *     --count 100 \
 *     --campaign PILOT_PROVIDER_FLYER \
 *     --name "Pilot Provider Flyer — May 2026" \
 *     --admin-id <AdminUser.id> \
 *     --out vouchers.csv
 *
 * The CSV contains raw codes for printing. Codes are hashed before DB insert.
 * The raw codes are NOT stored in the database.
 *
 * SECURITY: Treat the output CSV as sensitive — it contains raw codes.
 * Delete the file after printing. Do not commit it to git.
 */

import { parseArgs } from 'node:util'
import { createWriteStream } from 'node:fs'
import { db } from '../lib/db'
import { generateVoucherCode, voucherCodeToHash } from '../lib/vouchers'

const { values } = parseArgs({
  options: {
    count:           { type: 'string', default: '100' },
    campaign:        { type: 'string', default: 'PILOT_PROVIDER_FLYER' },
    name:            { type: 'string', default: 'Pilot Provider Flyer' },
    'admin-id':      { type: 'string' },
    out:             { type: 'string', default: 'vouchers.csv' },
    'expires-days':  { type: 'string' },
  },
  strict: true,
})

const count = parseInt(values.count ?? '100', 10)
const campaignCode = values.campaign ?? 'PILOT_PROVIDER_FLYER'
const batchName = values.name ?? 'Pilot Provider Flyer'
const adminId = values['admin-id']
const outFile = values.out ?? 'vouchers.csv'
const expiresDays = values['expires-days'] ? parseInt(values['expires-days'], 10) : null

if (!adminId) {
  console.error('Error: --admin-id is required. Find your AdminUser.id via the admin panel or DB.')
  process.exit(1)
}

const expiresAt = expiresDays
  ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000)
  : null

console.log(`Generating ${count} vouchers for campaign "${campaignCode}"…`)

// Generate all codes upfront before any DB writes
const rawCodes: string[] = []
const codeHashes: string[] = []
for (let i = 0; i < count; i++) {
  const code = generateVoucherCode()
  rawCodes.push(code)
  codeHashes.push(voucherCodeToHash(code))
}

// Create batch and vouchers in a single transaction
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

// Write CSV — raw codes only appear here. All fields quoted for RFC 4180 safety.
const csvQuote = (v: string) => `"${v.replace(/"/g, '""')}"`
const out = createWriteStream(outFile)
out.write('code,campaign_name,credit_amount,expires_at,created_at\n')
const createdAt = new Date().toISOString()
for (const code of rawCodes) {
  const expires = expiresAt?.toISOString() ?? ''
  out.write(`${csvQuote(code)},${csvQuote(campaignCode)},1,${csvQuote(expires)},${csvQuote(createdAt)}\n`)
}
out.end()

console.log(`✅ ${count} vouchers created. Raw codes exported to ${outFile}`)
console.log(`IMPORTANT: Treat ${outFile} as sensitive — delete after printing.`)
await db.$disconnect()
