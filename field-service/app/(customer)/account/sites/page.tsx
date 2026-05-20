// ─── Customer: Saved sites (address book) ────────────────────────────────────
// Authenticated customers can manage their saved service addresses.
// Unauthenticated users are redirected to /sign-in via proxy.ts.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveCustomerForSession } from '@/lib/customer-session'
import { buildMetadata } from '@/lib/metadata'
import { ChevronLeft, MapPin } from 'lucide-react'
import { AddSiteDialog, SiteCard } from './SitesClient'

export const metadata = buildMetadata({ title: 'Saved Sites', noIndex: true })

export default async function AccountSitesPage() {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent('/account/sites')}`)

  const customer = await resolveCustomerForSession(db, session)
  if (!customer) {
    // Authenticated but no Customer record yet - fresh PWA signup with no prior WA interaction
    redirect('/sign-in?next=/account/sites')
  }

  const sites = await db.customerAddress.findMany({
    where:   { customerId: customer.id },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div className="min-h-screen pb-32 screen-enter">
      <div className="px-[18px] pt-[60px] pb-4 flex items-center gap-3">
        <Link
          href="/bookings"
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <ChevronLeft size={18} style={{ color: 'var(--ink)' }} />
        </Link>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]" style={{ color: 'var(--ink)' }}>
          Saved sites
        </h1>
      </div>

      <div className="px-[18px] space-y-3">
        {sites.length === 0 ? (
          <div
            className="rounded-[20px] flex flex-col items-center py-12 text-center space-y-4"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <MapPin className="size-10" style={{ color: 'var(--brand-purple)' }} />
            <div className="space-y-1">
              <p className="font-medium" style={{ color: 'var(--ink)' }}>No saved sites yet</p>
              <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
                Add your first site so we can match you with providers in your area.
              </p>
            </div>
            <AddSiteDialog />
          </div>
        ) : (
          <>
            {sites.map((site) => (
              <SiteCard key={site.id} site={site} />
            ))}
            <AddSiteDialog />
          </>
        )}
      </div>
    </div>
  )
}
