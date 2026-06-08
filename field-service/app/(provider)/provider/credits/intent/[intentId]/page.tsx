export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { LockedTopUpScreen, PaymentIntentStatusClient } from '@/components/provider/credits'
import { getPaymentIntentStatus, getProviderCreditPurchaseGate } from '../../actions'
import ExpiredPayatIntentScreen from './expired'

function isExpired(expiresAt: string | null) {
  return expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false
}

export default async function ProviderPayatIntentPage({
  params,
  searchParams,
}: {
  params: Promise<{ intentId: string }>
  searchParams?: Promise<{ created?: string; status?: string }>
}) {
  const emptySearchParams: { created?: string; status?: string } = {}
  const [{ intentId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve(emptySearchParams),
  ])
  const status = await getPaymentIntentStatus(intentId)

  if (!status.ok) {
    if (status.code === 'FORBIDDEN') {
      const gate = await getProviderCreditPurchaseGate()
      return <LockedTopUpScreen creditGateStatus={gate.creditGateStatus} />
    }
    notFound()
  }

  if (
    resolvedSearchParams.status === 'expired' ||
    status.status === 'EXPIRED' ||
    (status.status !== 'CREDITED' && isExpired(status.expiresAt))
  ) {
    return <ExpiredPayatIntentScreen />
  }

  if (!status.paymentLink && !status.sourceReference) notFound()

  return (
    <PaymentIntentStatusClient
      intentId={intentId}
      amountCents={status.amountCents}
      creditsToIssue={status.creditsToIssue}
      reference={status.reference}
      paymentLink={status.paymentLink}
      sourceReference={status.sourceReference}
      expiresAt={status.expiresAt}
      showCreatingFirst={resolvedSearchParams.created === '1'}
    />
  )
}
