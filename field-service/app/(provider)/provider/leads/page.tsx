// Provider: Pending leads inbox
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Inbox, MapPin, Clock3, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getProviderLeadListForProvider } from '@/lib/provider-lead-list'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'

export const metadata = buildMetadata({ title: 'My Leads', noIndex: true })

export default async function ProviderLeadsPage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
  })

  if (!provider) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="Your provider account isn’t set up yet"
          description="Reach out to support to finish onboarding."
        />
      </div>
    )
  }

  const leads = await getProviderLeadListForProvider(provider.id)

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <PageHeader
        eyebrow="Leads"
        title="Open opportunities"
        description={
          leads.length === 0
            ? 'You’re all caught up — we’ll WhatsApp you the moment a new lead arrives.'
            : `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} waiting for your response.`
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="No new leads right now"
          description="Stay available and keep credits topped up — leads land here as soon as customers raise jobs in your area."
        />
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => {
            const isExpired = lead.expiresAt && lead.expiresAt < new Date()
            const timeLeft = lead.expiresAt
              ? isExpired
                ? 'Expired'
                : `Expires ${formatDistanceToNow(lead.expiresAt, { addSuffix: true })}`
              : null

            const statusVariant: 'neutral' | 'info' | 'warning' = isExpired
              ? 'neutral'
              : lead.status === 'VIEWED'
                ? 'info'
                : 'warning'
            const statusLabel = isExpired
              ? 'Expired'
              : lead.status === 'VIEWED'
                ? 'Viewed'
                : 'New'

            return (
              <Link
                key={lead.id}
                href={`/provider/leads/${lead.id}`}
                className="group block rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-soft)] transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold capitalize text-foreground">
                      {lead.category.replaceAll('_', ' ')}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {lead.area}
                    </p>
                  </div>
                  <Badge variant={statusVariant}>{statusLabel}</Badge>
                </div>

                {lead.shortDescription ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {lead.shortDescription}
                  </p>
                ) : null}

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs">
                  <span className="text-muted-foreground">
                    Ref · {lead.id.slice(-8).toUpperCase()}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      isExpired ? 'text-[var(--tone-danger-fg)]' : 'text-primary'
                    }`}
                  >
                    {timeLeft ? (
                      <>
                        <Clock3 className="size-3.5" />
                        {timeLeft}
                      </>
                    ) : (
                      <>
                        Open
                        <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
