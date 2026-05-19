export const dynamic = 'force-dynamic'

import { CreditsEntryClient } from '@/components/provider/credits'
import { buildMetadata } from '@/lib/metadata'
import { getProviderWallet } from './actions'

export const metadata = buildMetadata({ title: 'Provider Credits', noIndex: true })

export default async function ProviderCreditsPage() {
  const wallet = await getProviderWallet()

  return <CreditsEntryClient wallet={wallet} />
}
