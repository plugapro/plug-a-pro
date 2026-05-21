export const dynamic = 'force-dynamic'

import { buildMetadata } from '@/lib/metadata'
import { HistoryClient } from '@/components/provider/credits'
import { getProviderWalletLedgerPage } from '../actions'

export const metadata = buildMetadata({ title: 'Credit history', noIndex: true })

export default async function ProviderCreditsHistoryPage() {
  const { items, nextCursor } = await getProviderWalletLedgerPage({ filter: 'all' })

  return (
    <HistoryClient
      initialItems={items}
      initialNextCursor={nextCursor}
      initialFilter="all"
    />
  )
}
