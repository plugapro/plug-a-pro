export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth'
import { recordAuditLog } from '@/lib/audit'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { rolesForCapability, roleCan } from '@/lib/ops-dashboard/permissions'
import { normaliseLocationDisplayName } from '@/lib/location-format'

export const metadata = buildMetadata({ title: 'Client Requests', noIndex: true })

function maskPhone(phone: string | null | undefined) {
  if (!phone) return 'No phone'
  return phone.length <= 6 ? '***' : `${phone.slice(0, 4)}***${phone.slice(-3)}`
}

function formatAddress(address: {
  street: string
  suburb: string
  city: string
  province: string
  accessNotes: string | null
} | null) {
  if (!address) return 'No address'
  return [
    address.street,
    normaliseLocationDisplayName(address.suburb),
    normaliseLocationDisplayName(address.city),
    normaliseLocationDisplayName(address.province),
  ].filter(Boolean).join(', ')
}

export default async function AdminClientRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ sensitive?: string; status?: string }>
}) {
  const admin = await requireRole(rolesForCapability('viewRequests'))
  const { sensitive, status = 'ALL' } = await searchParams
  const showSensitive = sensitive === '1' && roleCan(admin.adminRole, 'viewSensitiveCustomerDetails')

  const statusFilter = ['PENDING_VALIDATION', 'OPEN', 'MATCHING', 'SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING', 'MATCHED', 'EXPIRED', 'CANCELLED'].includes(status)
    ? status as never
    : undefined

  if (showSensitive) {
    await recordAuditLog({
      actorId: admin.adminUserId ?? admin.id,
      actorRole: admin.adminRole,
      action: 'ops.client_requests.view_sensitive',
      entityType: 'JobRequest',
      entityId: 'list',
      after: { statusFilter: statusFilter ?? 'ALL' },
    }).catch(() => undefined)
  }

  const requests = await db.jobRequest.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    select: {
      id: true,
      category: true,
      subcategory: true,
      title: true,
      description: true,
      urgency: true,
      status: true,
      source: true,
      createdAt: true,
      requestedWindowStart: true,
      requestedWindowEnd: true,
      customer: { select: { id: true, name: true, phone: true } },
      address: { select: { street: true, suburb: true, city: true, province: true, accessNotes: true } },
      selectedProvider: { select: { id: true, name: true } },
      selectedLeadInvite: { select: { id: true, status: true, providerAcceptedAt: true } },
      attachments: { select: { id: true, label: true }, take: 6 },
      shortlists: {
        orderBy: { publishedAt: 'desc' },
        take: 1,
        select: { id: true, status: true, _count: { select: { items: true } } },
      },
      match: {
        select: {
          id: true,
          status: true,
          provider: { select: { id: true, name: true } },
          booking: { select: { id: true, status: true, job: { select: { id: true, status: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Client requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor WhatsApp and PWA requests, matching state, shortlists, selected providers, and job progress.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/client-requests?sensitive=1">View sensitive</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/dispatch">Dispatch queue</Link>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Request</th>
              <th className="px-4 py-3 text-left font-medium">Customer</th>
              <th className="px-4 py-3 text-left font-medium">Area</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Shortlist</th>
              <th className="px-4 py-3 text-left font-medium">Provider / Job</th>
              <th className="px-4 py-3 text-left font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {requests.map((request) => {
              const shortlist = request.shortlists[0] ?? null
              const job = request.match?.booking?.job ?? null
              return (
                <tr key={request.id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{request.id.slice(-8).toUpperCase()}</p>
                    <p className="font-medium">{request.category}{request.subcategory ? ` / ${request.subcategory}` : ''}</p>
                    <p className="max-w-sm text-xs text-muted-foreground line-clamp-2">{request.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{request.source ?? 'unknown source'} · {request.createdAt.toLocaleString('en-ZA')}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${request.customer.id}`} className="font-medium hover:text-primary">
                      {request.customer.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{showSensitive ? request.customer.phone : maskPhone(request.customer.phone)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{request.address ? `${normaliseLocationDisplayName(request.address.suburb)}, ${normaliseLocationDisplayName(request.address.city)}` : 'No area'}</p>
                    {showSensitive ? (
                      <p className="max-w-xs text-xs text-muted-foreground">{formatAddress(request.address)}{request.address?.accessNotes ? ` · Access: ${request.address.accessNotes}` : ''}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Exact address hidden</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={request.status} type="jobRequest" />
                    {request.urgency ? <p className="mt-1 text-xs text-muted-foreground">{request.urgency}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    {shortlist ? (
                      <div className="space-y-1">
                        <Badge variant="outline">{shortlist.status}</Badge>
                        <p className="text-xs text-muted-foreground">{shortlist._count.items} option(s)</p>
                        <Link href="/admin/shortlists" className="text-xs text-primary underline">Open shortlist view</Link>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No shortlist</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{request.match?.provider?.name ?? request.selectedProvider?.name ?? 'Not selected'}</p>
                    {job ? <StatusBadge status={job.status} type="job" /> : request.selectedLeadInvite ? <Badge variant="secondary">{request.selectedLeadInvite.status}</Badge> : null}
                    {request.match?.booking ? (
                      <p><Link href={`/admin/bookings/${request.match.booking.id}`} className="text-xs text-primary underline">Open booking</Link></p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {request.attachments.length} attachment{request.attachments.length === 1 ? '' : 's'}
                  </td>
                </tr>
              )
            })}
            {requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No requests found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
