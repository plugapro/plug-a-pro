import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAuthenticatedCustomerContext } from '@/lib/server/client'

const statusLabel: Record<string, string> = {
  PENDING_VALIDATION: 'Submitted',
  OPEN: 'Matching',
  MATCHING: 'Matching',
  SHORTLIST_READY: 'Shortlist ready',
  PROVIDER_CONFIRMATION_PENDING: 'Awaiting provider',
  MATCHED: 'Booked',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
}

export default async function ClientRequestsPage() {
  const auth = await getAuthenticatedCustomerContext()
  if (!auth) redirect('/sign-in?next=/client/requests')

  const requests = await db.jobRequest.findMany({
    where: { customerId: auth.customer.id },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
    },
  })

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
        <Link
          href="/client/new-request"
          className="rounded-xl px-3 py-2 text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #FF1F8E 0%, #8B3FE8 50%, #2A78F0 100%)' }}
        >
          New request
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-[var(--ink-mute)]">
          No requests yet. Start a new request to get matched with a provider.
        </div>
      ) : (
        <div className="grid gap-2">
          {requests.map((request) => (
            <Link
              key={request.id}
              href={`/client/requests/${request.id}`}
              className="rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-[var(--card-alt)]"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{request.title || 'Request'}</p>
                <span className="rounded-full bg-[var(--card-alt)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-mute)]">
                  {statusLabel[request.status] ?? request.status}
                </span>
              </div>
              <p className="font-mono text-[11px] text-[var(--ink-mute)]">{request.id}</p>
              <p className="mt-1 text-xs text-[var(--ink-mute)]">
                Updated {request.updatedAt.toLocaleDateString('en-ZA')}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
