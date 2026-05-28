// Manual escape hatch for the same prunes the cron at
// /api/cron/otp-security-prune runs on schedule. Each step runs
// independently so a failure in one doesn't block the others.
import { db } from '../lib/db'
import {
  pruneClearedAccountSecurityStates,
  pruneStaleSecurityEvents,
  pruneTerminalOtpChallenges,
} from '../lib/otp-security'

async function runStep(label: string, fn: () => Promise<{ deleted: number }>): Promise<void> {
  try {
    const result = await fn()
    console.log(`Pruned ${result.deleted} ${label}.`)
  } catch (err) {
    console.error(`Failed to prune ${label}:`, err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}

async function main() {
  await runStep('terminal OTP challenge(s)', pruneTerminalOtpChallenges)
  await runStep('stale security_event(s)', pruneStaleSecurityEvents)
  await runStep('cleared account_security_state(s)', pruneClearedAccountSecurityStates)
}

main().finally(() => db.$disconnect())
