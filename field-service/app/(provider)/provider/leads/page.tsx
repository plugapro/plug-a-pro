// Provider: Pending leads inbox
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Inbox, MapPin, Clock3, Sparkles } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { getProviderLeadListForProvider } from '@/lib/provider-lead-list'
import { SectionLabel } from '@/components/ui/section-label'
import { StatusDot } from '@/components/ui/status-dot'

export const metadata = buildMetadata({ title: 'My Leads', noIndex: true })

export default async function ProviderLeadsPage() {
  const session = await requireProvider()

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
  })

  if (!provider) {
    return (
      <div className="px-[18px] pt-[60px] pb-10 text-center">
        <p className="text-[14px] text-[var(--ink-mute)]">Provider account not set up. Contact support.</p>
      </div>
    )
  }

  const leads = await getProviderLeadListForProvider(provider.id)

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--brand-purple)] mb-1">
          Leads
        </p>
        <h1 className="text-[28px] font-bold tracking-[-0.025em] leading-[1.1] text-[var(--ink)]">
          Open opportunities
        </h1>
        <p className="mt-1.5 text-[14px] text-[var(--ink-mute)]">
          {leads.length === 0
            ? 'All caught up — we\'ll WhatsApp you when a new lead arrives.'
            : `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} waiting for your response.`}
        </p>
      </div>

      <div className="px-[18px]">
        {leads.length === 0 ? (
          <div className="bg-card rounded-[24px] shadow-[inset_0_0_0_1px_var(--border)] p-8 text-center">
            <div className="w-14 h-14 rounded-[18px] brand-gradient-soft flex items-center justify-center mx-auto mb-4">
              <Inbox size={26} className="text-[var(--brand-purple)]" />
            </div>
            <p className="text-[15px] font-bold text-[var(--ink)] tracking-[-0.01em] mb-2">No new leads right now</p>
            <p className="text-[13.5px] text-[var(--ink-mute)] max-w-[260px] mx-auto leading-relaxed">
              Stay available and keep credits topped up — leads land here as soon as customers raise jobs in your area.
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

              const tone = isExpired ? 'idle' : lead.status === 'VIEWED' ? 'success' : 'warn'
              const statusLabel = isExpired ? 'Expired' : lead.status === 'VIEWED' ? 'Viewed' : 'New'

              return (
                <Link
                  key={lead.id}
                  href={`/provider/leads/${lead.id}`}
                  className="block bg-card rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[var(--shadow-float)] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-px overflow-hidden"
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p className="text-[15px] font-bold text-[var(--ink)] tracking-[-0.015em] capitalize">
                        {lead.category.replaceAll('_', ' ')}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusDot tone={tone} size={7} />
                        <span className="text-[12px] font-semibold text-[var(--ink-mute)]">{statusLabel}</span>
                      </div>
                    </div>

                    <p className="flex items-center gap-1 text-[13px] text-[var(--ink-mute)] mb-2">
                      <MapPin size={13} />
                      {lead.area}
                    </p>

                    {lead.shortDescription && (
                      <p className="text-[13px] text-[var(--ink-mute)] line-clamp-2 mb-3">
                        {lead.shortDescription}
                      </p>
                    )}

                    <div className="border-t border-[var(--border)] pt-3 flex items-center justify-between">
                      <span className="font-mono text-[11.5px] text-[var(--ink-soft)] tracking-wider">
                        PAP-{lead.id.slice(-8).toUpperCase()}
                      </span>
                      <span className={`flex items-center gap-1 text-[12.5px] font-semibold ${isExpired ? 'text-[var(--danger)]' : 'text-[var(--brand-purple)]'}`}>
                        {timeLeft ? (
                          <>
                            <Clock3 size={13} />
                            {timeLeft}
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} />
                            View lead
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
