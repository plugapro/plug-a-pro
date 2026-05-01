// Provider: Pending leads inbox
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { formatDistanceToNow } from 'date-fns'
import { getProviderLeadListForProvider } from '@/lib/provider-lead-list'

export const metadata = buildMetadata({ title: 'My Leads', noIndex: true })

export default async function ProviderLeadsPage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
  })

  if (!provider) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground">
        <p>Your provider account is not yet set up.</p>
      </div>
    )
  }

  const leads = await getProviderLeadListForProvider(provider.id)

  return (
    <div className="px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">
          {leads.length === 0
            ? 'No pending leads'
            : `${leads.length} pending lead${leads.length === 1 ? '' : 's'} awaiting your response`}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center space-y-2">
          <p className="text-muted-foreground">No new leads right now.</p>
          <p className="text-sm text-muted-foreground">
            You&apos;ll get a WhatsApp notification when a new lead arrives.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => {
            const isExpired = lead.expiresAt && lead.expiresAt < new Date()
            const timeLeft = lead.expiresAt
              ? isExpired
                ? 'Expired'
                : `Expires ${formatDistanceToNow(lead.expiresAt, { addSuffix: true })}`
              : null

            return (
              <Link
                key={lead.id}
                href={`/provider/leads/${lead.id}`}
                className="block rounded-xl border bg-card p-4 space-y-2 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-foreground">{lead.category}</p>
                    <p className="text-sm text-muted-foreground">{lead.area}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    isExpired
                      ? 'bg-muted text-muted-foreground'
                      : lead.status === 'VIEWED'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {isExpired ? 'Expired' : lead.status === 'VIEWED' ? 'Viewed' : 'New'}
                  </span>
                </div>

                {lead.shortDescription && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {lead.shortDescription}
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Ref: {lead.id.slice(-8).toUpperCase()}</span>
                  {timeLeft && (
                    <span className={isExpired ? 'text-destructive' : ''}>{timeLeft}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
