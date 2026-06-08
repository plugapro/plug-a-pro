export const dynamic = 'force-dynamic'

import { PendingIntentList } from '@/components/provider/credits'
import { getProviderCreditPurchaseGate, getProviderPendingIntents } from '../actions'

export default async function ProviderCreditsPendingPage() {
  const gate = await getProviderCreditPurchaseGate()
  const intents = gate.creditPurchaseLocked ? [] : await getProviderPendingIntents()

  return (
    <PendingIntentList
      intents={intents}
      creditPurchaseLocked={gate.creditPurchaseLocked}
      creditGateStatus={gate.creditGateStatus}
    />
  )
}
