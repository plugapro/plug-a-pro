// ─── Admin: Bookings board ─────────────────────────────────────────────────────
// Table view of all bookings with status filter.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { BookingStatus } from '@prisma/client'

export const metadata = buildMetadata({ title: 'Bookings', noIndex: true })

const STATUS_OPTIONS: { value: BookingStatus | 'ALL'; label: string }[] = [
  { value: 'ALL',         label: 'All' },
  { value: 'SCHEDULED',   label: 'Scheduled' },
  { value: 'RESCHEDULED', label: 'Rescheduled' },
  { value: 'COMPLETED',   label: 'Completed' },
  { value: 'CANCELLED',   label: 'Cancelled' },
]

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireAdmin()
  const { status } = await searchParams

  const statusFilter = (status as BookingStatus) || undefined
  const isValidStatus = STATUS_OPTIONS.some(
    (o) => o.value !== 'ALL' && o.value === statusFilter
  )

  const bookings = await db.booking.findMany({
    where: isValidStatus ? { status: statusFilter } : undefined,
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: { select: { name: true, phone: true } },
              address:  { select: { suburb: true, city: true } },
            },
          },
          provider: { select: { name: true } },
        },
      },
      quote: { select: { amount: true } },
      job:   { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground mt-1">{bookings.length} bookings</p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const active =
            opt.value === 'ALL'
              ? !statusFilter || !isValidStatus
              : opt.value === statusFilter
          return (
            <Link
              key={opt.value}
              href={opt.value === 'ALL' ? '/admin/bookings' : `/admin/bookings?status=${opt.value}`}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-foreground text-background'
                  : 'border hover:bg-accent text-muted-foreground'
              )}
            >
              {opt.label}
            </Link>
          )
        })}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Job Request</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Booking</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  No bookings found
                </TableCell>
              </TableRow>
            )}
            {bookings.map((b) => {
              const customer = b.match?.jobRequest?.customer
              const address  = b.match?.jobRequest?.address
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/admin/bookings/${b.id}`} className="hover:text-primary">
                      {b.id.slice(-8).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <p>{customer?.name ?? '-'}</p>
                    <p className="text-xs text-muted-foreground">{customer?.phone ?? ''}</p>
                  </TableCell>
                  <TableCell>
                    <p>{b.match?.jobRequest?.title ?? '-'}</p>
                    <p className="text-xs text-muted-foreground">{b.match?.jobRequest?.category ?? ''}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {address ? `${address.suburb}, ${address.city}` : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.scheduledDate
                      ? b.scheduledDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
                      : '-'}
                    {b.scheduledWindow && (
                      <p className="text-xs">{b.scheduledWindow}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} type="booking" />
                  </TableCell>
                  <TableCell>
                    {b.job ? (
                      <StatusBadge status={b.job.status} type="job" />
                    ) : (
                      <span className="text-xs text-muted-foreground">No job</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.match?.provider?.name ?? '-'}
                  </TableCell>
                  <TableCell className="font-medium">
                    R {Number(b.quote?.amount ?? 0).toFixed(2)}
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
