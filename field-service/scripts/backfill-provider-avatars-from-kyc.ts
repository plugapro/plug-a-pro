/**
 * backfill-provider-avatars-from-kyc.ts
 *
 * Copies the KYC selfie to Provider.avatarUrl for every provider who:
 *   - has no current avatarUrl
 *   - has at least one PASSED identity verification
 *   - whose most recent PASSED verification has an UPLOADED SELFIE document
 *
 * Only the selfie is used — ID document images are never exposed as avatars.
 * Safe to run multiple times — providers with an existing avatarUrl are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-provider-avatars-from-kyc.ts [--dry-run]
 *
 * Requires:
 *   DATABASE_URL
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   BLOB_READ_WRITE_TOKEN   (Vercel Blob)
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { copyKycSelfieToProviderAvatar } from '../lib/storage'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`backfill-provider-avatars-from-kyc — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const candidates = await db.providerIdentityVerification.findMany({
    where: {
      decision: 'PASS',
      status: 'PASSED',
      provider: {
        avatarUrl: null,
        id: { not: undefined },
      },
      documents: {
        some: {
          documentKind: 'SELFIE',
          status: 'UPLOADED',
        },
      },
    },
    select: {
      id: true,
      provider: { select: { id: true, name: true, avatarUrl: true } },
      documents: {
        where: { documentKind: 'SELFIE', status: 'UPLOADED' },
        select: { blobKey: true, mimeType: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Multiple passed verifications per provider are possible; keep only one candidate per provider.
  const seenProviders = new Set<string>()
  const unique = candidates.filter(v => {
    if (!v.provider?.id || seenProviders.has(v.provider.id)) return false
    seenProviders.add(v.provider.id)
    return true
  })

  console.log(`Found ${unique.length} provider(s) to backfill`)

  let copied = 0
  let skipped = 0
  let failed = 0

  for (const verification of unique) {
    const provider = verification.provider!
    const selfieDoc = verification.documents[0]

    if (!selfieDoc?.blobKey) {
      console.log(`  SKIP  provider=${provider.id} (${provider.name}) — no selfie blobKey`)
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`  DRY   provider=${provider.id} (${provider.name}) verification=${verification.id}`)
      copied++
      continue
    }

    try {
      const avatarUrl = await copyKycSelfieToProviderAvatar({
        blobKey: selfieDoc.blobKey,
        mimeType: selfieDoc.mimeType ?? 'image/jpeg',
        providerId: provider.id,
      })
      await db.provider.update({
        where: { id: provider.id },
        data: { avatarUrl },
      })
      console.log(`  OK    provider=${provider.id} (${provider.name}) → ${avatarUrl}`)
      copied++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  FAIL  provider=${provider.id} (${provider.name}) — ${message}`)
      failed++
    }
  }

  console.log(`\nDone: ${copied} copied, ${skipped} skipped, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
