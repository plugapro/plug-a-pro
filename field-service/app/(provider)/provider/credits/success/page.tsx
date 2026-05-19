export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { SuccessScreen } from '@/components/provider/credits'
import { getPaymentIntentStatus, getProviderWallet } from '../actions'

export default async function ProviderCreditsSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ intentId?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const intentId = resolvedSearchParams.intentId
  if (!intentId) notFound()

  const [status, wallet] = await Promise.all([
    getPaymentIntentStatus(intentId),
    getProviderWallet(),
  ])

  if (!status.ok || status.status !== 'CREDITED') notFound()

  return (
    <SuccessScreen
      creditsIssued={status.creditsIssued ?? status.creditsToIssue}
      balance={wallet.credits}
      starter={wallet.starter}
      reference={status.reference}
    />
  )
}
