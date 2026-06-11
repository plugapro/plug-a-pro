import { isEnabled } from '../flags'
import { formatRandsFromCents } from './constants'
import { getKycFeeStatus } from './ledger'

/**
 * One sentence describing the provider's KYC fee outcome, for appending to
 * verification-success notifications. Null when the fee model is off or
 * there is nothing to say.
 */
export async function kycFeeOutcomeSentence(providerId: string): Promise<string | null> {
  if (!(await isEnabled('kyc.fee_accrual.enabled'))) return null
  const status = await getKycFeeStatus(providerId)
  if (status.lastReason === 'KYC_FEE_SPONSORED' && status.outstandingCents === 0) {
    return 'Good news: your once-off ID verification fee has been covered by a Plug A Pro launch voucher - nothing to pay.'
  }
  if (status.outstandingCents > 0) {
    return `A once-off ${formatRandsFromCents(status.outstandingCents)} verification recovery fee will be recovered from your first top-up.`
  }
  return null
}
