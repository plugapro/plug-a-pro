// ─── Customer: Saved sites (address book) ────────────────────────────────────
// Authenticated customers can manage their saved service addresses.
// Unauthenticated users are redirected to /sign-in via proxy.ts.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { MapPin } from 'lucide-react'
import { AddSiteDialog, SiteCard } from './SitesClient'

export const metadata = buildMetadata({ title: 'Saved Sites', noIndex: true })

export default async function AccountSitesPage() {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/account/sites')}`)

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    // Authenticated but no Customer record yet — fresh PWA signup with no prior WA interaction
    redirect('/sign-in?next=/account/sites')
  }

  const sites = await db.customerAddress.findMany({
    where:   { customerId: customer.id },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Saved sites</h1>
      </div>

      {sites.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center space-y-4">
          <MapPin className="size-10 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">No saved sites yet</p>
            <p className="text-sm text-muted-foreground">
              Add your first site so we can match you with providers in your area.
            </p>
          </div>
          <AddSiteDialog />
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {sites.map((site) => (
              <SiteCard key={site.id} site={site} />
            ))}
          </div>

          <AddSiteDialog />
        </>
      )}
    </div>
  )
}
