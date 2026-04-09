export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Matches', noIndex: true })

export default async function MatchesModerationPage() {
  await requireAdmin()

  const matches = await db.match.findMany({
    include: {
      jobRequest: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: { select: { suburb: true, city: true } },
        },
      },
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      booking: {
        include: {
          job: { select: { id: true, status: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  const pendingInspection = matches.filter((match) => match.status === 'INSPECTION_SCHEDULED').length
  const awaitingQuoteDecision = matches.filter(
    (match) => match.status === 'QUOTED' && match.quotes[0]?.status === 'PENDING',
  ).length
  const activeJobs = matches.filter((match) => Boolean(match.booking?.job)).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Matches moderation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review active matches, inspections, quotes, and booked jobs from one place.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Inspection pending" value={pendingInspection} />
        <SummaryCard label="Awaiting quote decision" value={awaitingQuoteDecision} />
        <SummaryCard label="Booked jobs" value={activeJobs} />
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Match</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Match status</TableHead>
              <TableHead>Quote</TableHead>
              <TableHead>Booking / Job</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No matches yet.
                </TableCell>
              </TableRow>
            )}
            {matches.map((match) => {
              const latestQuote = match.quotes[0] ?? null
              return (
                <TableRow key={match.id}>
                  <TableCell>
                    <p className="font-mono text-xs">{match.id.slice(-8).toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground capitalize">{match.jobRequest.category}</p>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/customers/${match.jobRequest.customer.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {match.jobRequest.customer.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{match.jobRequest.customer.phone}</p>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/providers/${match.provider.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {match.provider.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{match.provider.phone}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {match.jobRequest.address
                      ? `${match.jobRequest.address.suburb}, ${match.jobRequest.address.city}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={match.status} type="match" />
                  </TableCell>
                  <TableCell>
                    {latestQuote ? (
                      <div className="space-y-1">
                        <StatusBadge status={latestQuote.status} type="quote" />
                        <p className="text-xs text-muted-foreground">
                          R {Number(latestQuote.amount).toFixed(2)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No quote yet</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {match.booking ? (
                      <div className="space-y-1">
                        <Link
                          href={`/admin/bookings/${match.booking.id}`}
                          className="text-sm font-medium hover:text-primary"
                        >
                          Booking {match.booking.id.slice(-8).toUpperCase()}
                        </Link>
                        {match.booking.job ? (
                          <StatusBadge status={match.booking.job.status} type="job" />
                        ) : (
                          <StatusBadge status={match.booking.status} type="booking" />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not booked yet</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
