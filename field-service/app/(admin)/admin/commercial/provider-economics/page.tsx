export const dynamic = 'force-dynamic'

import { ProviderEconomicsCalculator } from '@/components/admin/commercial/ProviderEconomicsCalculator'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
// SECURITY (54bc65eb): the full commercial note lives in the server-only pricing
// module. Reading it here (server component, behind requireAdmin) and passing it
// as a prop keeps it out of the public client bundle.
import { SMILE_SECURE_COMMERCIAL_NOTE } from '@/lib/commercial/smileid-pricing'

export const metadata = buildMetadata({ title: 'Provider Economics', noIndex: true })

export default async function ProviderEconomicsPage() {
  const admin = await requireAdmin()
  const diditScenarioEnabled = await isEnabled('admin.commercial.economics.didit_scenario', { userId: admin.id })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Provider economics</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Model onboarding identity checks (SmileID or Didit), fixed technology costs, active-provider upkeep
          and lead break-even economics. This excludes people and operational resourcing costs.
        </p>
      </div>

      <ProviderEconomicsCalculator
        diditScenarioEnabled={diditScenarioEnabled}
        smileSecureNote={SMILE_SECURE_COMMERCIAL_NOTE}
      />
    </div>
  )
}
