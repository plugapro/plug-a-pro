export const dynamic = 'force-dynamic'

import { CreditsEntryClient } from '@/components/provider/credits'
import { buildMetadata } from '@/lib/metadata'
import { PROVIDER_CREDIT_PRICE_ZAR } from '@/lib/provider-wallet'
import { getProviderKycFeeBanner, getProviderWallet } from './actions'

export const metadata = buildMetadata({ title: 'Provider Credits', noIndex: true })

export default async function ProviderCreditsPage() {
  const [wallet, kycFeeBanner] = await Promise.all([
    getProviderWallet(),
    getProviderKycFeeBanner(),
  ])

  return (
    <>
      {kycFeeBanner && (
        <div
          data-testid="kyc-fee-banner"
          className="bg-muted/50 mx-4 mt-4 rounded-lg border p-3 text-sm"
        >
          {kycFeeBanner.text}
        </div>
      )}
      <CreditsEntryClient wallet={wallet} creditPriceZar={PROVIDER_CREDIT_PRICE_ZAR} />
    </>
  )
}
