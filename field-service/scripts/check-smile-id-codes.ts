#!/usr/bin/env tsx
/**
 * Drift check: fetch Smile's result-codes reference page and compare known
 * EVD codes against what's in our result-codes.ts. Run in CI so a Smile-side
 * addition or rename surfaces immediately.
 *
 * Exit codes:
 *   0 = no drift detected
 *   1 = drift detected (new EVD code found that's not in our sets)
 *   2 = could not fetch the page (network issue; informational)
 */

import {
  SMILE_ID_EVD_PASS_RESULT_CODES,
  SMILE_ID_EVD_FAIL_RESULT_CODES,
} from '../lib/identity-verification/vendors/smile-id/result-codes'

const RESULT_CODES_URL = 'https://docs.usesmileid.com/further-reading/result-codes'

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

  const known = new Set([...SMILE_ID_EVD_PASS_RESULT_CODES, ...SMILE_ID_EVD_FAIL_RESULT_CODES])
  const drift = [...onPage].filter(code => !known.has(code))

  if (drift.length === 0) {
    console.log(`No EVD result-code drift. ${onPage.size} codes on page, all accounted for.`)
    process.exit(0)
  }

  console.error(`EVD result-code drift detected. Page has codes we don't map:`)
  for (const code of drift) console.error(`  - ${code}`)
  console.error('Update lib/identity-verification/vendors/smile-id/result-codes.ts')
  process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(2)
})
