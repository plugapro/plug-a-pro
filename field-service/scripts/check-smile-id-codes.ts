#!/usr/bin/env tsx
/**
 * Drift check: fetch Smile's result-codes reference page and compare known
 * EVD codes against what's in our result-codes.ts. Run in CI so a Smile-side
 * addition or rename surfaces immediately.
 *
 * Exit codes:
 *   0 = no drift detected
 *   1 = drift detected (new EVD code found that's not in our sets and not
 *       in scripts/smile-id-codes-acknowledged.json)
 *   2 = could not fetch the page (network issue; informational, soft pass)
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  SMILE_ID_EVD_FAIL_RESULT_CODES,
} from '../lib/identity-verification/vendors/smile-id/result-codes'

const RESULT_CODES_URL = 'https://docs.usesmileid.com/further-reading/result-codes'

function resolveScriptDir(): string {
  // tsx runs this with `module: esnext` so import.meta.url is available;
  // fall back to process.cwd()/scripts for CommonJS-emulated edge cases.
  try {
    return path.dirname(fileURLToPath(import.meta.url))
  } catch {
    return path.join(process.cwd(), 'scripts')
  }
}

function loadAcknowledgedCodes(): Set<string> {
  const ackPath = path.join(resolveScriptDir(), 'smile-id-codes-acknowledged.json')
  try {
    const raw = readFileSync(ackPath, 'utf8')
    const data = JSON.parse(raw) as { acknowledged_unclassified_codes?: string[] }
    return new Set(data.acknowledged_unclassified_codes ?? [])
  } catch (e) {
    console.warn(`Could not read ${ackPath}: ${(e as Error).message}`)
    return new Set()
  }
}

async function main() {
  let html: string
  try {
    const r = await fetch(RESULT_CODES_URL, { headers: { 'user-agent': 'plug-a-pro-ci-driftcheck' } })
    if (!r.ok) {
      console.warn(`Smile docs returned ${r.status}; skipping drift check`)
      process.exit(2)
    }
    html = await r.text()
  } catch (e) {
    console.warn(`Could not fetch result codes page: ${(e as Error).message}`)
    process.exit(2)
  }

  // EVD codes are in the 08xx range; 1014 is also relevant.
  const onPage = new Set<string>()
  for (const match of html.matchAll(/\b(08[0-9]{2})\b/g)) {
    onPage.add(match[1])
  }
  if (/\b1014\b/.test(html)) onPage.add('1014')

  const acknowledged = loadAcknowledgedCodes()
  const known = new Set<string>([
    ...SMILE_ID_EVD_PASS_RESULT_CODES,
    ...SMILE_ID_EVD_FAIL_RESULT_CODES,
    ...acknowledged,
  ])
  const drift = [...onPage].filter(code => !known.has(code))

  const classifiedCount = SMILE_ID_EVD_PASS_RESULT_CODES.size + SMILE_ID_EVD_FAIL_RESULT_CODES.size

  if (drift.length === 0) {
    console.log(
      `No new EVD result-code drift. ${onPage.size} codes on page, ${acknowledged.size} acknowledged-pending, ${classifiedCount} classified.`,
    )
    process.exit(0)
  }

  console.error(`EVD result-code drift detected. Page has codes not classified and not acknowledged:`)
  for (const code of drift) console.error(`  - ${code}`)
  console.error(
    'Either classify into lib/identity-verification/vendors/smile-id/result-codes.ts',
  )
  console.error(
    'or add to scripts/smile-id-codes-acknowledged.json (with a follow-up to classify).',
  )
  process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(2)
})
