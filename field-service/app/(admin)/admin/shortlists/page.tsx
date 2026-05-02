export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { rolesForCapability } from '@/lib/ops-dashboard/permissions'
import { normaliseLocationDisplayName } from '@/lib/location-format'

export const metadata = buildMetadata({ title: 'Shortlists', noIndex: true })

function money(value: unknown) {
  if (value == null) return 'No fee'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value))
}

function dateTime(value: Date | null | undefined) {
  return value ? value.toLocaleString('en-ZA') : 'No ETA'
}

export default async function AdminShortlistsPage() {
  await requireRole(rolesForCapability('viewRequests'))

  const requests = await db.jobRequest.findMany({
    where: {
      OR: [
        { status: { in: ['OPEN', 'MATCHING', 'SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING', 'MATCHED'] } },
        { shortlists: { some: {} } },
        { leads: { some: {} } },
      ],
    },
    select: {
      id: true,
      category: true,
      subcategory: true,
      status: true,
      createdAt: true,
      address: { select: { suburb: true, city: true, province: true } },
      selectedProvider: { select: { id: true, name: true } },
      selectedLeadInvite: { select: { id: true, status: true, providerAcceptedAt: true } },
      leads: {
        orderBy: { sentAt: 'desc' },
        take: 12,
        select: {
          id: true,
          status: true,
          sentAt: true,
          expiresAt: true,
          provider: { select: { id: true, name: true, active: true, verified: true, status: true } },
          providerResponses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              response: true,
              callOutFee: true,
              estimatedArrivalAt: true,
              negotiable: true,
              providerNote: true,
              createdAt: true,
            },
          },
        },
      },
      shortlists: {
        orderBy: { publishedAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          publishedAt: true,
          items: {
            orderBy: { rank: 'asc' },
            select: {
              id: true,
              rank: true,
              providerId: true,
              leadInviteId: true,
              customerSelectedAt: true,
              displayCallOutFee: true,
              displayArrivalTime: true,
              provider: { select: { id: true, name: true, verified: true, averageRating: true, completedJobsCount: true } },
            },
          },
        },
      },
      dispatchDecisions: {
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          status: true,
          consideredCount: true,
          eligibleCount: true,
          explanation: true,
          filterSummary: true,
          rankingSummary: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 80,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Matching queue and shortlists</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect provider invites, responses, shortlist publication, customer selection, and final provider acceptance.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/dispatch">Open dispatch tools</Link>
        </Button>
      </div>

      <div className="space-y-4">
        {requests.map((request) => {
          const shortlist = request.shortlists[0] ?? null
          return (
            <section key={request.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{request.id.slice(-8).toUpperCase()}</p>
                  <h2 className="text-base font-semibold">{request.category}{request.subcategory ? ` / ${request.subcategory}` : ''}</h2>
                  <p className="text-sm text-muted-foreground">
                    {request.address ? `${normaliseLocationDisplayName(request.address.suburb)}, ${normaliseLocationDisplayName(request.address.city)}, ${normaliseLocationDisplayName(request.address.province)}` : 'No area'} · {request.createdAt.toLocaleString('en-ZA')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={request.status} type="jobRequest" />
                  {shortlist ? <Badge variant="outline">Shortlist {shortlist.status}</Badge> : <Badge variant="secondary">No shortlist</Badge>}
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Latest matching decisions</h3>
                  {request.dispatchDecisions.length === 0 ? <p className="text-xs text-muted-foreground">No dispatch decision rows.</p> : null}
                  {request.dispatchDecisions.map((decision) => (
                    <div key={decision.id} className="rounded-lg border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">{decision.status}</Badge>
                        <span className="text-muted-foreground">{decision.createdAt.toLocaleTimeString('en-ZA')}</span>
                      </div>
                      <p className="mt-2 text-muted-foreground">{decision.explanation}</p>
                      <p className="mt-1">Considered {decision.consideredCount} · eligible {decision.eligibleCount}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Provider responses</h3>
                  {request.leads.length === 0 ? <p className="text-xs text-muted-foreground">No provider invites yet.</p> : null}
                  {request.leads.map((lead) => {
                    const response = lead.providerResponses[0] ?? null
                    return (
                      <div key={lead.id} className="rounded-lg border p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/admin/providers/${lead.provider.id}`} className="font-medium hover:text-primary">{lead.provider.name}</Link>
                          <Badge variant={lead.status === 'ACCEPTED' ? 'default' : lead.status === 'DECLINED' || lead.status === 'EXPIRED' ? 'destructive' : 'secondary'}>{lead.status}</Badge>
                        </div>
                        {response ? (
                          <p className="mt-1 text-muted-foreground">
                            {response.response} · {money(response.callOutFee)} · {dateTime(response.estimatedArrivalAt)} · {response.negotiable ? 'negotiable' : 'fixed'}
                          </p>
                        ) : (
                          <p className="mt-1 text-muted-foreground">No response yet · expires {lead.expiresAt?.toLocaleString('en-ZA') ?? 'not set'}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Customer shortlist</h3>
                  {!shortlist ? <p className="text-xs text-muted-foreground">No published shortlist yet.</p> : null}
                  {shortlist?.items.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">#{item.rank} {item.provider.name}</span>
                        {item.customerSelectedAt ? <Badge>Selected</Badge> : <Badge variant="outline">Option</Badge>}
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {money(item.displayCallOutFee)} · {dateTime(item.displayArrivalTime)} · {item.provider.verified ? 'verified' : 'unverified'}
                      </p>
                    </div>
                  ))}
                  <div className="rounded-lg bg-muted p-3 text-xs">
                    <p className="font-medium">Final selection</p>
                    <p className="mt-1 text-muted-foreground">
                      {request.selectedProvider?.name ?? 'No provider selected'}
                      {request.selectedLeadInvite ? ` · ${request.selectedLeadInvite.status}` : ''}
                      {request.selectedLeadInvite?.providerAcceptedAt ? ` · accepted ${request.selectedLeadInvite.providerAcceptedAt.toLocaleString('en-ZA')}` : ''}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
