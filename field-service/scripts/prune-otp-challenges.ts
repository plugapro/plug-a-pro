import { db } from '../lib/db'
import { pruneTerminalOtpChallenges } from '../lib/otp-security'

pruneTerminalOtpChallenges()
  .then((result) => {
    console.log(`Pruned ${result.deleted} terminal OTP challenge(s).`)
  })
  .finally(() => db.$disconnect())
