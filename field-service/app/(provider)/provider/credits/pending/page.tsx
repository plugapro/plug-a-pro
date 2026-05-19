export const dynamic = 'force-dynamic'

import { PendingIntentList } from '@/components/provider/credits'
import { getProviderPendingIntents } from '../actions'

export default async function ProviderCreditsPendingPage() {
  const intents = await getProviderPendingIntents()

  return <PendingIntentList intents={intents} />
}
